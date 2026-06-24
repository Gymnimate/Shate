import express from "express";
import path from "path";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const PORT = 3000;
const app = express();
app.use(express.json({ limit: "25mb" }));
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

let cachedAiClient: GoogleGenAI | null = null;
let lastUsedApiKey: string | null = null;

async function fetchSharedApiKey(): Promise<string | null> {
  try {
    const projectId = "gen-lang-client-0057515834";
    const apiKey = "AIzaSyDJreMZv1CexPEftGXJIGaBMrYB446Eq7Y";
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings/gemini?key=${apiKey}`;
    
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (data && data.fields && data.fields.apiKey && data.fields.apiKey.stringValue) {
      return data.fields.apiKey.stringValue;
    }
  } catch (err) {
    console.error("Error fetching shared API key from Firestore:", err);
  }
  return null;
}

async function getAiClient(): Promise<GoogleGenAI> {
  const dbApiKey = await fetchSharedApiKey();
  const keyToUse = dbApiKey || process.env.GEMINI_API_KEY;
  if (!keyToUse) {
    throw new Error("No Gemini API key found. Please configure it in Settings or environment variables.");
  }
  
  if (cachedAiClient && lastUsedApiKey === keyToUse) {
    return cachedAiClient;
  }
  
  console.log(`Initializing GoogleGenAI client with key: ${keyToUse.slice(0, 10)}...`);
  cachedAiClient = new GoogleGenAI({
    apiKey: keyToUse,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
  lastUsedApiKey = keyToUse;
  return cachedAiClient;
}

async function startServer() {
  // Upgrade handling for WebSockets
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
    if (pathname === '/ws-live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", async (clientWs: WebSocket) => {
    console.log("Client connected to live AI session");
    
    let session: any = null;
    let isReady = false;
    const audioQueue: string[] = [];
    let frameCount = 0;

    // Cache variables for state to avoid speaking when client connects/updates
    let cachedActiveChatId = "";
    let cachedActiveNoteId = "";
    let cachedExistingCards: any[] = [];
    let cachedSelectedDateStr = "";
    let cachedCurrentDateStr = "";
    let cachedModernSpaceContent = "";
    let cachedActiveNoteTitle = "Hlavní poznámka";
    let cachedAllNotes: any[] = [];
    let cachedAllChats: any[] = [];
    let cachedProfileMemo = "";
    let hasPendingStateSync = false;

    try {
      const activeAi = await getAiClient();
      session = await activeAi.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: async (message: LiveServerMessage) => {
            // Forward everything to client for simplicity
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify(message));
            }

            // Parse and translate transcriptions for bulletproof client forwarding
            const inputTx = (message as any).inputTranscription || (message as any).input_transcription || (message as any).input_audio_transcription || (message as any).inputAudioTranscription;
            if (inputTx?.text) {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                  type: "transcription",
                  role: "user",
                  text: inputTx.text
                }));
              }
            }

            const outputTx = (message as any).outputTranscription || (message as any).output_transcription || (message as any).output_audio_transcription || (message as any).outputAudioTranscription;
            if (outputTx?.text) {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                  type: "transcription",
                  role: "assistant",
                  text: outputTx.text
                }));
              }
            }

            const serverContent = message.serverContent || (message as any).server_content;
            if (serverContent) {
              const modelTurn = serverContent.modelTurn || serverContent.model_turn;
              if (modelTurn?.parts) {
                modelTurn.parts.forEach((part: any) => {
                  const audioTranscription = part.audioTranscription || part.audio_transcription;
                  if (audioTranscription?.text) {
                    if (clientWs.readyState === WebSocket.OPEN) {
                      clientWs.send(JSON.stringify({
                        type: "transcription",
                        role: "assistant",
                        text: audioTranscription.text
                      }));
                    }
                  }
                });
              }
            }

            // Look for toolCalls for background research and speed adjustments
            if (message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === "perform_web_research") {
                  const topic = (fc.args as any)?.topic || "obecné téma";
                  console.log(`Intercepted perform_web_research for topic: "${topic}"`);

                  // Reply immediately to tool call, unblocking model speech queue
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Výzkum na téma "${topic}" začal úspěšně na pozadí.`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response to live session:", err);
                  }

                  // Inform client that research started
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "research_started",
                      topic: topic
                    }));
                  }

                  // Run grounding search in raw background thread (no awaiting!)
                  (async () => {
                    let bgRes: any = null;
                    let usedSearch = true;
                    try {
                      console.log(`Starting background grounding query for: "${topic}"`);
                      const activeAi = await getAiClient();
                      bgRes = await activeAi.models.generateContent({
                        model: "gemini-flash-latest",
                        contents: `Vytvoř prosím přehledný pomocný tahák (cheat sheet) k učení a krátký přehled na téma "${topic}". 
Výsledek vrať VÝHRADNĚ jako platný JSON objekt se dvěma klíči:
1. "content" (stručný a přehledný obsah taháku v češtině formátovaný v Markdownu s odrážkami a tučnými slovy, může obsahovat vzorce, překlady či příklady a případně 1-2 nejlepší a doporučené internetové odkazy z vyhledávání)
2. "subject" (krátký, výstižný český název školního předmětu, např. Matematika, Fyzika, Chemie, Biologie, Dějepis, Zeměpis, Čeština, Cizí jazyky, Informatika, Společenské vědy).
Nevracej žádné jiné věci nebo text okolo, pouze čistý platný JSON objekt.`,
                        config: {
                          tools: [{ googleSearch: {} }]
                        }
                      });
                    } catch (searchErr: any) {
                      console.warn("Background grounding search with Google Search tool failed, trying fallback without Google Search...", searchErr.message || searchErr);
                      usedSearch = false;
                      try {
                        const activeAi = await getAiClient();
                        bgRes = await activeAi.models.generateContent({
                          model: "gemini-flash-latest",
                          contents: `Vytvoř prosím přehledný pomocný tahák (cheat sheet) z tvých znalostí na téma "${topic}".
Výsledek vrať VÝHRADNĚ jako platný JSON objekt se dvěma klíči:
1. "content" (rychlá pomůcka k učení přizpůsobená tématu s odrážkami, krátkými odstavce, vzorci nebo definicemi, formátovaná v češtině pomocí Markdownu)
2. "subject" (krátký český název školního předmětu, např. Matematika, Fyzika, Chemie, Biologie, Dějepis, Zeměpis, Čeština, Cizí jazyky, Informatika).`,
                        });
                      } catch (fallbackErr: any) {
                        console.error("Critical: both background research query with and without search failed:", fallbackErr);
                        if (clientWs.readyState === WebSocket.OPEN) {
                          clientWs.send(JSON.stringify({
                            type: "research_error",
                            topic: topic,
                            error: "Došlo k chybě při vygenerování podkladů."
                          }));
                        }
                        return;
                      }
                    }

                    try {
                      const sources: Array<{ title: string; url: string }> = [];
                      if (usedSearch && bgRes) {
                        const chunks = bgRes.candidates?.[0]?.groundingMetadata?.groundingChunks;
                        if (chunks) {
                          for (const chunk of chunks) {
                            if (chunk.web?.uri) {
                              sources.push({
                                title: chunk.web.title || "Zdroj",
                                url: chunk.web.uri
                              });
                            }
                          }
                        }
                      }

                      let resultText = "Pro toto téma se nepodařilo nalézt podklady.";
                      let subjectText = "Všeobecné";
                      try {
                        const parsedObj = JSON.parse(bgRes?.text || "{}");
                        resultText = parsedObj.content || bgRes?.text || "";
                        subjectText = parsedObj.subject || "Všeobecné";
                      } catch {
                        // Fallback parsing if JSON was surrounded by markdown quotes
                        let cleaned = (bgRes?.text || "").trim();
                        if (cleaned.startsWith("```json")) {
                          cleaned = cleaned.replace(/^```json/, "").replace(/```$/, "").trim();
                        } else if (cleaned.startsWith("```")) {
                          cleaned = cleaned.replace(/^```/, "").replace(/```$/, "").trim();
                        }
                        try {
                          const parsedObj = JSON.parse(cleaned);
                          resultText = parsedObj.content || bgRes?.text || "";
                          subjectText = parsedObj.subject || "Všeobecné";
                        } catch {
                          resultText = bgRes?.text || "Pro toto téma se nepodařilo nalézt podklady.";
                          subjectText = "Všeobecné";
                        }
                      }

                      if (!usedSearch) {
                        resultText += "\n\n*(Sestaveno z vědomostí Shate - vyhledávání má pauzu.)*";
                      }

                      console.log(`Background grounding search completed for topic: "${topic}" (usedSearch=${usedSearch}, subject=${subjectText})`);

                      if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                          type: "research_ready",
                          topic: topic,
                          result: resultText,
                          subject: subjectText,
                          sources: sources
                        }));
                      }

                      // Instruct model to state research completed
                      if (session) {
                        session.sendRealtimeInput({
                          text: `[SYSTEM: Průzkum na téma "${topic}" byl právě dokončen a výsledky byly zobrazeny uživateli na obrazovce. ${!usedSearch ? 'Vyhledávání na internetu mělo vyčerpanou kvótu, takže jsi výzkum složil ze svých rozsáhlých vestavěných znalostí.' : ''} Oznam to uživateli s nadšením a navrhni, že ho to začneš učit. Zeptej se, s čím chce začít.]`
                        });
                      }

                    } catch (err) {
                      console.error("Background research error during completion processing:", err);
                      if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                          type: "research_error",
                          topic: topic,
                          error: "Došlo k chybě při vyhodnocení podkladů."
                        }));
                      }
                    }
                  })();
                }

                if (fc.name === "change_voice_speed") {
                  const speed = Number((fc.args as any)?.speed) || 1.4;
                  console.log(`Intercepted change_voice_speed request: speed=${speed}`);

                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Rychlost řeči byla přenastavena na ${speed}x.`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for change_voice_speed:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "voice_speed_changed",
                      speed: speed
                    }));
                  }
                }

                if (fc.name === "get_notes") {
                  console.log(`Intercepted get_notes request. Cached content length: ${cachedModernSpaceContent.length}`);
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            activeNoteTitle: cachedActiveNoteTitle,
                            allNotes: cachedAllNotes,
                            content: cachedModernSpaceContent || "Poznámkový blok je zatím prázdný.",
                            allChats: cachedAllChats
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for get_notes:", err);
                  }
                }

                if (fc.name === "create_new_note") {
                  const title = (fc.args as any)?.title || "";
                  console.log(`Intercepted create_new_note request with title: "${title}"`);
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Nová stránka poznámek s názvem "${title || "bez názvu"}" byla úspěšně vytvořena.`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for create_new_note:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "create_new_note",
                      title: title
                    }));
                  }
                }

                if (fc.name === "select_note") {
                  const title = (fc.args as any)?.title || "";
                  console.log(`Intercepted select_note request with title: "${title}"`);
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Aktivní zobrazení bylo přepnuto na stránku poznámek "${title}".`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for select_note:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "select_note",
                      title: title
                    }));
                  }
                }

                if (fc.name === "update_notes") {
                  const content = (fc.args as any)?.content || "";
                  console.log(`Intercepted update_notes request. New content length: ${content.length}`);
                  cachedModernSpaceContent = content;

                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: "Poznámkový blok byl úspěšně aktualizován."
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for update_notes:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "update_modern_space",
                      content: content
                    }));
                  }
                }

                if (fc.name === "update_profile_memo") {
                  const memo = (fc.args as any)?.memo || "";
                  console.log(`Intercepted update_profile_memo request. New memo length: ${memo.length}`);
                  cachedProfileMemo = memo;

                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: "Osobní profil a preference byly úspěšně aktualizovány a Shate si je zapamatoval."
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for update_profile_memo:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "update_profile_memo",
                      memo: memo
                    }));
                  }
                }

                if (fc.name === "open_settings_view") {
                  console.log("Intercepted open_settings_view request");

                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: "Sekce nastavení v rozhraní byla úspěšně otevřena."
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for open_settings_view:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "open_settings_view"
                    }));
                  }
                }

                if (fc.name === "close_settings_view") {
                  console.log("Intercepted close_settings_view request");

                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: "Okno s nastavením bylo v rozhraní úspěšně zavřeno."
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for close_settings_view:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "close_settings_view"
                    }));
                  }
                }

                if (fc.name === "select_chat") {
                  const title = (fc.args as any)?.title || "";
                  console.log(`Intercepted select_chat request with title: "${title}"`);
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Aktivní konverzace byla přepnuta na chat "${title}".`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for select_chat:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "select_chat",
                      title: title
                    }));
                  }
                }

                if (fc.name === "rename_chat") {
                  const title = (fc.args as any)?.title || "";
                  console.log(`Intercepted rename_chat request with new title: "${title}"`);
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Aktuální chat byl přejmenován na "${title}".`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for rename_chat:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "rename_chat",
                      title: title
                    }));
                  }
                }

                if (fc.name === "rename_note") {
                  const title = (fc.args as any)?.title || "";
                  console.log(`Intercepted rename_note request with new title: "${title}"`);
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Aktuální poznámka byla přejmenována na "${title}".`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for rename_note:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "rename_note",
                      title: title
                    }));
                  }
                }

                if (fc.name === "create_folder") {
                  const title = (fc.args as any)?.title || "";
                  const parentFolderTitle = (fc.args as any)?.parentFolderTitle || null;
                  console.log(`Intercepted create_folder: title="${title}", parentFolderTitle="${parentFolderTitle}"`);
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Nová složka "${title}" byla úspěšně vytvořena.`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for create_folder:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "create_folder",
                      title: title,
                      parentFolderTitle: parentFolderTitle
                    }));
                  }
                }

                if (fc.name === "rename_folder") {
                  const oldTitle = (fc.args as any)?.oldTitle || "";
                  const newTitle = (fc.args as any)?.newTitle || "";
                  console.log(`Intercepted rename_folder: oldTitle="${oldTitle}", newTitle="${newTitle}"`);
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Složka "${oldTitle}" byla přejmenována na "${newTitle}".`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for rename_folder:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "rename_folder",
                      oldTitle: oldTitle,
                      newTitle: newTitle
                    }));
                  }
                }

                if (fc.name === "delete_folder") {
                  const title = (fc.args as any)?.title || "";
                  console.log(`Intercepted delete_folder: title="${title}"`);
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Složka "${title}" byla smazána a poznámky byly přesunuty do hlavní úrovně.`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for delete_folder:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "delete_folder",
                      title: title
                    }));
                  }
                }

                if (fc.name === "move_note_to_folder") {
                  const noteTitle = (fc.args as any)?.noteTitle || "";
                  const folderTitle = (fc.args as any)?.folderTitle || null;
                  console.log(`Intercepted move_note_to_folder: noteTitle="${noteTitle}", folderTitle="${folderTitle}"`);
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Poznámka "${noteTitle}" byla přesunuta do složky "${folderTitle || "hlavní úrovně"}".`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for move_note_to_folder:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "move_note",
                      noteTitle: noteTitle,
                      folderTitle: folderTitle
                    }));
                  }
                }

                if (fc.name === "move_folder") {
                  const folderTitle = (fc.args as any)?.folderTitle || "";
                  const parentFolderTitle = (fc.args as any)?.parentFolderTitle || null;
                  console.log(`Intercepted move_folder: folderTitle="${folderTitle}", parentFolderTitle="${parentFolderTitle}"`);
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Složka "${folderTitle}" byla přesunuta do složky "${parentFolderTitle || "hlavní úrovně"}".`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for move_folder:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "move_folder",
                      folderTitle: folderTitle,
                      parentFolderTitle: parentFolderTitle
                    }));
                  }
                }

                if (fc.name === "toggle_folder") {
                  const title = (fc.args as any)?.title || "";
                  const isCollapsed = (fc.args as any)?.isCollapsed !== false;
                  console.log(`Intercepted toggle_folder: title="${title}", isCollapsed=${isCollapsed}`);
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: {
                          output: {
                            status: `Složka "${title}" byla úspěšně ${isCollapsed ? "zavinuta" : "rozvinuta"}.`
                          }
                        }
                      }]
                    });
                  } catch (err) {
                    console.error("Failed to send tool response for toggle_folder:", err);
                  }

                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: "toggle_folder",
                      title: title,
                      isCollapsed: isCollapsed
                    }));
                  }
                }
              }
            }
          }
        },
        config: {
          generationConfig: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Puck"
                }
              }
            }
          },
          systemInstruction: `POZNÁMKA K INICIACI RELACE: Na začátku relace nebo po spuštění spojení NIKDY nic neříkej jako první, neposílej žádné automatické uvítání a nezačínej mluvit sám od sebe. Zůstaň naprosto potichu, neodpovídej na synchronizační systémové aktualizace a tiché aktualizace stavu, a vyčkej, až uživatel sám jako první promluví do mikrofonu!

Jsi Shate, inteligentní hlasový asistent, osobní plánovač, doprovod a rádce. Mluv česky, stručně, přátelsky, srozumitelně a klidně. Vždy vystupuj jako kluk/muž (mluv v mužském rodě, např. 'napsal jsem', 'přidal jsem', 'upravil jsem').
Odpovídej věcně a stručně. NIKDY se na konci své odpovědi neptej vlezle a opakovaně na to, zda chceš v poznámkách něco změnit, upravit či dopsat sám od sebe (např. 'Chceš tam něco dopsat?', 'Chceš, abych to změnil?' apod.). Nech iniciativu na uživateli a neptej se ho v každé druhé větě na to, zda si přeje další úpravy.

STYL TEXTU A FORMÁTOVÁNÍ:
- Piš a odpovídej VŽDY standardním souvislým textem (v odstavcích bez odrážek či bodů), pokud tě uživatel sám výslovně nepožádá o vypsání v odrážkách/bodech (např. 'vypiš to v bodech', 'dej to do odrážek').
- Seznamy, body nebo odrážky používej VÝHRADNĚ na výslovnou žádost uživatele.
- Když už tě uživatel požádá o body/odrážky, nepoužívej složité víceúrovňové odrážky ani pododrážky jako v receptu. Použij VŽDY výhradně jednoduchou pomlčku '-' následovanou mezerou a textem (např. '- zápis...').

HLAVNÍ ROLE: Pomáháš uživateli spravovat a upravovat jeho poznámkový blok/místo na poznámky (Notes) a odpovídat na otázky ohledně nich.
- VŽDY VÍŠ, NA CO SE UŽIVATEL KOUKÁ. Aktivní stránka má svůj název, obsah a v chatu máš k dispozici seznam všech dalších stránek. Tyto informace o kontextu okamžitě získáš vyvoláním funkce 'get_notes'. Použij je, abys byl v obraze a věděl, co má uživatel před sebou, ale nezmiňuj to roboticky ani se jimi nechlub, pokud o nich uživatel sám nezačne mluvit. Možnost získat tyto informace ti zaručí, že nikdy nezačneš mluvit o ničem jiném!
- NESMÍŠ přepisovat ani ukládat žádnou poznámku ('update_notes'), pokud tě k tomu uživatel sám explicitně nevyzve (např. 'ulož to', 'napiš to tam', 'zapiš si'). Pokud se tě uživatel pouze ptá na nějaký dotaz, řešíte teorii nebo jen tak konverzujete, odpověz mu výhradně hlasem a neupravuj poznámky, dokud ti neřekne, abys to do poznámek dopsal či uložil!
- Pokud tě uživatel požádá, abys do poznámek něco zapsal, přidal, upravil, vysvětlil nebo stručně shrnul, vyvolej funkci 'get_notes' pro zjištění aktuálního obsahu, plynule a logicky do něj začleň nové poznatky (v souladu s pravidly pro 'STYL TEXTU A FORMÁTOVÁNÍ') a ulož nový kompletní stav voláním funkce 'update_notes'. NIKDY nesmaž stávající důležité poznámky uživatele bez výslovného vyzvání! Nové poznatky a zjištění vždy plynule doplňuj k těm stávajícím.
- Můžeš vytvořit novou prázdnou stránku poznámek pomocí 'create_new_note' s volitelným názvem (např. 'Recepty', 'Fyzika').
- Můžeš přepínat aktivní zobrazení na konkrétní stránku poznámek podle jejího názvu pomocí 'select_note' (např. přepni na 'Matematika').
- Podporuješ také vyhledávání na internetu: pokud uživatel potřebuje podrobnější informace nebo vysvětlení složitějšího tématu, zkus vyvolat 'perform_web_research', který na pozadí připraví komplexní tahák a zobrazí ho uživateli.
 - Můžeš také uživateli změnit rychlost řeči pomocí 'change_voice_speed' nebo otevřít nastavení pomocí 'open_settings_view'.
- CO O UŽIVATELI VÍŠ (PROSPĚCH, PRŮBĚH & PREFERENCE): Vždy měj na paměti, co si o uživateli pamatuješ (jeho preference, zájmy, jméno, rozepsané plány). Pokud tě uživatel požádá, abys si něco o něm zapamatoval (např. 'zapamatuj si, že se chci naučit algoritmizaci'), vyvolej 'update_profile_memo' a přidej to tam!`,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          tools: [
            {
              functionDeclarations: [
                {
                  name: "change_voice_speed",
                  description: "Změní rychlost mluvení/hlasu asistenta Shate. Použít, pokud uživatel požádá o mluvení pomaleji / zpomalení nebo rychleji / zrychlení.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      speed: {
                        type: Type.NUMBER,
                        description: "Nová rychlost mluvení (např. 1.0 pro normální rychlost, 1.4 pro výchozí rychlou/energickou, 0.85 pro velmi pomalou)."
                      }
                    },
                    required: ["speed"]
                  }
                },
                {
                  name: "get_notes",
                  description: "Získá aktuální obsah poznámkového bloku (Notes) uživatele.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {}
                  }
                },
                {
                  name: "update_notes",
                  description: "Aktualizuje, nahradí nebo zcela změní celý obsah uživatelova poznámkového bloku (Notes) o přehledný text v češtině formátovaný v elegantním Markdownu.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      content: {
                        type: Type.STRING,
                        description: "Kompletní nové znění celého poznámkového bloku v češtině a Markdownu."
                      }
                    },
                    required: ["content"]
                  }
                },
                {
                  name: "update_profile_memo",
                  description: "Uloží nebo aktualizuje osobní informace, zájmy a doplňující preference o uživateli do jeho profilu tak, aby si to Shate pamatoval (např. 'zapamatuj si, že piju černou kávu').",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      memo: {
                        type: Type.STRING,
                        description: "Celý aktualizovaný a sloučený text profilu a preferencí uživatele."
                      }
                    },
                    required: ["memo"]
                  }
                },
                {
                  name: "perform_web_research",
                  description: "Spustí vyhledávání a podrobný výzkum na internetu na pozadí na zvolené téma.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      topic: {
                        type: Type.STRING,
                        description: "Téma nebo otázka, kterou chce uživatel vyhledat (např. 'derivace v matematice')."
                      }
                    },
                    required: ["topic"]
                  }
                },
                {
                  name: "open_settings_view",
                  description: "Otevře okno / panel s nastavením v aplikaci na základě žádosti uživatele (např. 'otevři nastavení').",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {}
                  }
                },
                {
                  name: "create_new_note",
                  description: "Vytvoří novou, prázdnou stránku poznámek v aktuálním chatu. Může mít volitelný název (např. 'Matematika' nebo 'Recepty'). Použij, pokud uživatel požádá o vytvoření nové poznámky, přidání nového listu či stránky.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      title: {
                        type: Type.STRING,
                        description: "Název nové stránky poznámek (např. 'Kuchařka', 'Fyzika')."
                      }
                    }
                  }
                },
                {
                  name: "select_note",
                  description: "Přepne aktivní zobrazení na konkrétní existující stránku poznámek podle jejího přesného či částečného názvu. Použij, pokud uživatel požádá o přepnutí, zobrazení, otevření nebo vybrání konkrétní stránky.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      title: {
                        type: Type.STRING,
                        description: "Název stránky, na kterou chce uživatel přepnout zobrazení."
                      }
                    },
                    required: ["title"]
                  }
                },
                {
                  name: "select_chat",
                  description: "Přepne aktivní konverzaci (úplně jiný chat se Shate v postranním panelu) na jiný existující chat podle jeho názvu. Použij, pokud uživatel požádá o přepnutí na jiný chat konverzace, otevření jiného chatu apod.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      title: {
                        type: Type.STRING,
                        description: "Název chatu/konverzace, na kterou chce uživatel přepnout (např. 'Matematika' nebo 'Dějepis')."
                      }
                    },
                    required: ["title"]
                  }
                },
                {
                  name: "rename_chat",
                  description: "Přejmenuje aktuální chat/konverzaci na nový výstižný název. Použij, pokud uživatel požádá o přejmenování chatu na jiný název.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      title: {
                        type: Type.STRING,
                        description: "Nový název chatu/konverzace."
                      }
                    },
                    required: ["title"]
                  }
                },
                {
                  name: "rename_note",
                  description: "Přejmenuje aktuální zobrazenou poznámku/stránku na nový výstižný název. Použij, pokud uživatel požádá o přejmenování poznámky, stránky nebo chatu na jiný název.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      title: {
                        type: Type.STRING,
                        description: "Nový název poznámky/stránky."
                      }
                    },
                    required: ["title"]
                  }
                },
                {
                  name: "create_folder",
                  description: "Vytvoří novou složku se zadaným názvem v aktuálním chatu. Může mít volitelný název nadřazené složky, pokud má být podsložkou.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      title: {
                        type: Type.STRING,
                        description: "Název nové složky (např. 'Matematika')."
                      },
                      parentFolderTitle: {
                        type: Type.STRING,
                        description: "Volitelný název nadřazené složky (např. 'Skola')."
                      }
                    },
                    required: ["title"]
                  }
                },
                {
                  name: "rename_folder",
                  description: "Přejmenuje existující složku na nový název.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      oldTitle: {
                        type: Type.STRING,
                        description: "Aktuální starý název složky."
                      },
                      newTitle: {
                        type: Type.STRING,
                        description: "Nový požadovaný název složky."
                      }
                    },
                    required: ["oldTitle", "newTitle"]
                  }
                },
                {
                  name: "delete_folder",
                  description: "Smaže existující složku. Poznámky uvnitř složky budou přesunuty do hlavní úrovně.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      title: {
                        type: Type.STRING,
                        description: "Název složky, kterou chce uživatel smazat."
                      }
                    },
                    required: ["title"]
                  }
                },
                {
                  name: "move_note_to_folder",
                  description: "Přesune zadanou poznámku do zadané složky. Pokud je folderTitle null nebo prázdný, přesune poznámku do hlavní úrovně (mimo složky).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      noteTitle: {
                        type: Type.STRING,
                        description: "Název přesouvané poznámky."
                      },
                      folderTitle: {
                        type: Type.STRING,
                        description: "Název cílové složky nebo prázdná hodnota/null pro vyjmutí z jakékoliv složky do hlavní úrovně."
                      }
                    },
                    required: ["noteTitle"]
                  }
                },
                {
                  name: "move_folder",
                  description: "Přesune jednu složku do jiné složky jako podsložku, nebo do hlavní úrovně, pokud je parentFolderTitle null.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      folderTitle: {
                        type: Type.STRING,
                        description: "Název přesouvané složky."
                      },
                      parentFolderTitle: {
                        type: Type.STRING,
                        description: "Název cílové nadřazené složky nebo null pro přesun do hlavní úrovně."
                      }
                    },
                    required: ["folderTitle"]
                  }
                },
                {
                  name: "toggle_folder",
                  description: "Zavine (isCollapsed = true) nebo rozvine (isCollapsed = false) složku podle jejího názvu.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      title: {
                        type: Type.STRING,
                        description: "Název složky."
                      },
                      isCollapsed: {
                        type: Type.BOOLEAN,
                        description: "True pro zavinutí/sbalení složky, false pro její rozbalení/otevření."
                      }
                    },
                    required: ["title", "isCollapsed"]
                  }
                }
              ]
            }
          ]
        },
      });

      isReady = true;
      console.log("Gemini Live API connected successfully.");
      
      // Notify the client that the session is ready
      clientWs.send(JSON.stringify({ type: "session_ready" }));

      // Flush any queued audio received during connection phase
      if (audioQueue.length > 0) {
        console.log(`Flushing ${audioQueue.length} queued audio chunks to active session...`);
        while (audioQueue.length > 0) {
          const queuedAudio = audioQueue.shift();
          if (queuedAudio && session) {
            session.sendRealtimeInput({
              audio: { data: queuedAudio, mimeType: "audio/pcm;rate=16000" },
            });
          }
        }
      }

      clientWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.audio) {
            if (!isReady || !session) {
              // Store audio packet until the session connection resolves
              audioQueue.push(msg.audio);
              if (audioQueue.length % 10 === 0) {
                console.log(`Session connecting... queued ${audioQueue.length} audio chunks`);
              }
            } else {
              if (hasPendingStateSync) {
                hasPendingStateSync = false;
              }
              session.sendRealtimeInput({
                audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
              });
            }
          }
          if (msg.video) {
            if (isReady && session) {
              frameCount++;
              if (frameCount % 10 === 0) console.log(`Received ${frameCount} video frames from client`);
              session.sendRealtimeInput({
                video: { data: msg.video, mimeType: 'image/jpeg' }
              });
            }
          }
          if (msg.type === "sync_app_state") {
            if (msg.payload) {
              const info = msg.payload;
              const chatChanged = (cachedActiveChatId !== info.activeChatId);
              const noteChanged = (cachedActiveNoteId !== info.activeNoteId);
              const noteTitleChanged = (cachedActiveNoteTitle !== info.activeNoteTitle);
              const isNotesFocused = !!info.isNotesFocused;
              const contentChanged = (cachedModernSpaceContent !== info.modernSpaceContent);

              const shouldUpdateContext = chatChanged || noteChanged || noteTitleChanged || (contentChanged && !isNotesFocused);

              cachedActiveChatId = info.activeChatId || "";
              cachedActiveNoteId = info.activeNoteId || "";
              cachedExistingCards = info.existingCards || [];
              cachedSelectedDateStr = info.selectedDateStr || "";
              cachedCurrentDateStr = info.currentDateStr || "";
              cachedModernSpaceContent = info.modernSpaceContent || "";
              cachedActiveNoteTitle = info.activeNoteTitle || "Hlavní poznámka";
              cachedAllNotes = info.allNotes || [];
              cachedAllChats = info.allChats || [];
              cachedProfileMemo = info.profileMemo || "";
              hasPendingStateSync = true;
              console.log("Cached app state on server. Active chat: " + cachedActiveChatId + " Active note: " + cachedActiveNoteTitle + " (" + cachedActiveNoteId + ") Focused: " + isNotesFocused + " ContentChanged: " + contentChanged);

              if (shouldUpdateContext && session && isReady) {
                console.log(`Sending Live Session context update: switched chat/note or loaded content. Chat: "${cachedActiveChatId}", Note: "${cachedActiveNoteTitle}" (${cachedActiveNoteId})`);
                
                // Construct notes tree for this live session
                const getLiveTreeRepresentation = (pId: string | null = null, indent: string = ""): string => {
                  let text = "";
                  const folders = info.folders || [];
                  const notes = info.allNotes || [];
                  const currentFolders = folders.filter((f: any) => (f.parentId || null) === pId);
                  const currentNotes = notes.filter((n: any) => (n.folderId || null) === pId);

                  for (const folder of currentFolders) {
                    text += `${indent}📁 [Složka ID: "${folder.id}"] "${folder.title}" ${folder.isCollapsed ? "(zavinutá)" : "(rozvinutá)"}\n`;
                    text += getLiveTreeRepresentation(folder.id, indent + "  ");
                  }

                  for (const note of currentNotes) {
                    text += `${indent}📄 [Poznámka ID: "${note.id}"] "${note.title}"\n`;
                  }
                  return text;
                };
                
                const formattedNotesTree = getLiveTreeRepresentation(null);
                const systemMessage = `[SYSTEM CONTEXT: Uživatel právě přepnul své zobrazení / kontext.
- Aktuálně zobrazený chat/projekt ID: "${cachedActiveChatId}"
- Aktuálně otevřená stránka poznámek s názvem: "${cachedActiveNoteTitle}" (ID: "${cachedActiveNoteId}")
- Aktuální obsah této poznámky: "${cachedModernSpaceContent || "(poznámka je zatím prázdná)"}"
- Celá struktura složek a poznámek v tomto chatu:
${formattedNotesTree || "(žádné složky ani poznámky zatím neexistují)"}

Pokud chce uživatel zapsat poznámku, upravit ji, vytvořit složku nebo se o nich bavit, mluv s ním v kontextu této nově zvolené stránky a struktury!]`;

                try {
                  session.sendRealtimeInput({
                    text: systemMessage
                  });
                } catch (err) {
                  console.error("Failed to send active context update to live session:", err);
                }
              }
            }
          }
          if (msg.text) {
            if (isReady && session) {
              console.log(`Forwarding client helper text input to live session: "${msg.text}"`);
              session.sendRealtimeInput({
                text: msg.text
              });
            }
          }
          if (msg.toolResponse) {
            if (isReady && session) {
              session.sendToolResponse(msg.toolResponse);
            }
          }
          if (msg.end) {
            if (session) session.close();
          }
        } catch (err) {
          console.error("Error processing client message:", err);
        }
      });

      clientWs.on("close", () => {
        console.log("Client disconnected");
        if (session) session.close();
      });

    } catch (err) {
      console.error("Failed to connect to Gemini Live:", err);
      clientWs.close();
    }
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/chat-message", async (req, res) => {
    try {
      const { message, selectedDateStr, currentDateStr, existingCards, image, mimeType, history, attachedFile, modernSpaceContent, profileMemo, activeNoteTitle, allNotes, allChats, folders } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Zpráva nebyla poskytnuta." });
      }

      console.log(`Received text message from user: "${message}". Has image: ${!!image}. Has attachedFile: ${!!attachedFile}. Active note: "${activeNoteTitle || "Hlavní poznámka"}"`);
      const existingCardsFormatter = existingCards && existingCards.length > 0
        ? existingCards.map((c: any) => `Karta/Panel: "${c.subject || "Denní plán"}" (Záhlaví/Téma: "${c.topic}", Datum: ${c.targetDateStr || ""})\nObsah:\n${c.content}`).join("\n\n")
        : "Žádné existující karty dne.";

      const historyFormatter = history && history.length > 0
        ? history.slice(-6).map((h: any) => `Uživatel: "${h.userText || ""}"\nShate: "${h.assistantText || ""}"`).join("\n\n")
        : "Žádná předchozí historie konverzace v této relaci.";

      // Build a neat hierarchical tree of folders and notes
      const getTreeRepresentation = (pId: string | null = null, indent: string = ""): string => {
        let text = "";
        const currentFolders = (folders || []).filter((f: any) => (f.parentId || null) === pId);
        const currentNotes = (allNotes || []).filter((n: any) => (n.folderId || null) === pId);

        for (const folder of currentFolders) {
          text += `${indent}📁 [Složka ID: "${folder.id}"] "${folder.title}" ${folder.isCollapsed ? "(zavinutá)" : "(rozvinutá)"}\n`;
          text += getTreeRepresentation(folder.id, indent + "  ");
        }

        for (const note of currentNotes) {
          text += `${indent}📄 [Poznámka ID: "${note.id}"] "${note.title}"\n`;
        }
        return text;
      };

      const formattedNotesTree = getTreeRepresentation(null);

      const formattedAllChats = allChats && allChats.length > 0
        ? allChats.map((c: any) => `- "${c.title}"`).join("\n")
        : "- Žádné jiné existující chaty.";

      // Invoke Gemini to generate conversational feedback
      const activeAi = await getAiClient();
      const parts: any[] = [];
      if (image) {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
        parts.push({
          inlineData: {
            data: base64Data,
            mimeType: mimeType || "image/jpeg"
          }
        });
      }

      if (attachedFile) {
        if (attachedFile.base64) {
          const strippedBase64 = attachedFile.base64.replace(/^data:[^;]+;base64,/, "");
          parts.push({
            inlineData: {
              data: strippedBase64,
              mimeType: attachedFile.type || "application/octet-stream"
            }
          });
        }
        if (attachedFile.textContent) {
          parts.push({
            text: `[Uživatel přiložil textový soubor "${attachedFile.name}" s následujícím obsahem]\n=== OBSAH SOUBORU BLOK ===\n${attachedFile.textContent}\n=== KONEC OBSAHU SOUBORU ===\n`
          });
        }
      }

      const memoInstruction = profileMemo && profileMemo.trim()
        ? `\n- CO O UŽIVATELI VÍŠ (PROSPĚCH, PRŮBĚH & PREFERENCE):
"""
${profileMemo}
"""`
        : "";

      parts.push({
        text: `Jsi Shate, inteligentní osobní asistent, přítel, průvodce a chytrý doprovod. Vždy vystupuj jako kluk/muž (mluv v mužském rodě, např. 'napsal jsem', 'přidal jsem', 'upravil jsem'). Uživatel ti napsal zprávu v češtině: "${message}".
Tvoje odpověď musí být přátelská, srozumitelná, stručná a realizačně přesná. Odpovídej přímo a věcně bez zbytečného ptaní se.

STYL TEXTU A FORMÁTOVÁNÍ:
- Piš a odpovídej VŽDY standardním souvislým textem (v odstavcích bez odrážek či bodů), pokud tě uživatel sám výslovně nepožádá o vypsání v odrážkách/bodech (např. 'vypiš to v bodech', 'dej to do odrážek').
- Seznamy, body nebo odrážky používej VÝHRADNĚ na výslovnou žádost uživatele.
- Když už tě uživatel požádá o body/odrážky, nepoužívej složité víceúrovňové odrážky ani pododrážky. Použij VŽDY výhradně jednoduchou pomlčku '-' následovanou mezerou a textem.

HLAVNÍ ROLE: Pomáháš uživateli spravovat a upravovat jeho poznámkový blok se složkami.
VŽDY AKTIVNĚ VÍŠ, NA CO SE UŽIVATEL KOUKÁ A CO MÁ PŘED SEBOU.
- Uživatel má aktuálně otevřenou a zobrazenou stránku poznámek s názvem: "${activeNoteTitle || "Hlavní poznámka"}"
- Obsah této aktivně zobrazené stránky poznámek ("modernSpaceContent") je uveden níže.
- Struktura složek a stránek poznámek v tomto chatu:
${formattedNotesTree}

DŮLEŽITÁ PRAVIDLA PRO POZNÁMKY:
- KDYŽ TĚ UŽIVATEL POŽÁDÁ O ZÁPIS/PŘIDÁNÍ/ULOŽENÍ NEBO ÚPRAVU POZNÁMEK, **MUSÍŠ VŽDY** OBSAH UPRAVIT A VRÁTIT HO V KLÍČI "modernSpaceContent"! Pokud uživatel výslovně chce něco zapsat či uložit do aktivního zobrazení, nikdy nevracej "modernSpaceContent": null. Navrať v "modernSpaceContent" kompletní nový upravený text s plynule dodatečně připojeným novým záznamem.
- NESMÍŠ přepisovat ani ukládat žádnou změnu do poznámek (tzn. vracíš "modernSpaceContent": null) pouze v případě, že tě k tomu uživatel sám vůbec nevyzval a jen se obecně ptá. V takovém případě odpověz mu výhradně do "reply" a ponech "modernSpaceContent": null!
- Když ti uživatel řekne, abys něco do poznámek zapsal, zachovej minulé důležité poznámky a doplň nové poznatky plynule do nich.
- Nezmiňuj roboticky "vidím, že se koukáš na X" ani se informacemi o otevřené stránce nechlub. Jen měj tuto znalost na paměti, abys mohl správně a v kontextu odpovídat!

AKCE PRO STRÁNKY, SLOŽKY A KONVERZACE (KLÍČ "action"):
Pokud tě uživatel požádá, aby ses přepnul na jinou stránku poznámek, zobrazil jinou poznámku, vytvořil novou stránku, přesunul poznámku do složky, vytvořil složku, rozvinul nebo zavinul složku, můžeš vrátit odpovídající akci v klíči "action":
- Pro vytvoření nové prázdné stránky poznámek s názvem "X":
  {"type": "create_new_note", "title": "X"}
- Pro přepnutí zobrazení na konkrétní existující stránku poznámek podle jejího přibližného či přesného názvu "Y":
  {"type": "select_note", "title": "Y"}
- Pro přejmenování aktuálně otevřené poznámky na nový název "Z":
  {"type": "rename_note", "title": "Z"}
- Pro vytvoření nové složky s názvem "X" (např. "vytvoř složku Matematika"):
  {"type": "create_folder", "title": "X"}
- Pro zavinutí nebo rozvinutí složky s názvem "S":
  {"type": "toggle_folder", "title": "S", "isCollapsed": true/false}
- Pro přesun poznámky s názvem "N" do složky s názvem "F":
  {"type": "move_note", "noteTitle": "N", "folderTitle": "F"}
- Pro vyjmutí poznámky s názvem "N" ze složky do hlavní úrovně (kořene):
  {"type": "move_note", "noteTitle": "N", "folderTitle": null}
V ostatních případech ponech klíč "action" jako null.

DŮLEŽITÉ POKYNY:
- Pokud se uživatel zeptá, na jakou poznámku se teď dívá, na co se kouká nebo jakou poznámku má otevřenou, odpověz mu naprosto jasně: "Teď se díváš na poznámku '${activeNoteTitle || "Hlavní poznámka"}'."
- Pokud uživatel požádá o změnu názvu poznámky, použij action "rename_note" s novým požadovaným názvem.
- Uživatel má stále k dispozici jeden hlavní chat se Shate na pravé straně, a na levé straně má přehlednou správu svých složek a poznámek.

${memoInstruction}

PŘEDCHOZÍ PRŮBĚH KONVERZACE (HISTORIE RELACE):
${historyFormatter}

AKTUÁLNÍ KONTEXT:
- Dnešní datum (currentDate): ${currentDateStr || "neznámé"}
- Aktuálně zobrazená stránka poznámek: "${activeNoteTitle || "Hlavní poznámka"}"
- Aktuální obsah zobrazené stránky poznámek k úpravě (modernSpaceContent):
"""
${modernSpaceContent || "(Poznámky jsou zatím prázdné)"}
"""

Odpověz VÝHRADNĚ ve formátu JSON s těmito vlastnostmi:
{
  "reply": "Přátelská, velmi stručná odpověď v češtině (1 až 2 věty!), např. 'Jasný, zapsal jsem ti podrobné poznámky o derivacích přímo do tvého panelu.'",
  "modernSpaceContent": "Kompletní nové nebo upravené znění celého aktivního poznámkového bloku v češtině v Markdownu (včetně všech ponechaných předchozích poznámek), nebo null pokud se v tomto kroku nic nemění.",
  "profileMemo": "Kompletní starý nebo nově upravený a obohacený text se všemi fakty, jménem a preferencemi o uživateli (pokud ti uživatel zrovna řekl nějaké nové info o sobě, přidej to sem a vrať celou sjednocenou verzi, jinak vrať stávající text z 'CO O UŽIVATELI VÍŠ').",
  "card": null,
  "action": { "type": "create_new_note" | "select_note" | "rename_note" | "create_folder" | "toggle_folder" | "move_note", "title": "název stránky/složky" } nebo null
}
Pokud plánovací karta (card) není pro konverzaci užitečná, nastav klíč "card" na null.
Nevracej žádný jiný text než čistý JSON.`
      });

      const response = await activeAi.models.generateContent({
        model: "gemini-flash-latest",
        contents: parts,
        config: {
          responseMimeType: "application/json",
          tools: [{ googleSearch: {} }]
        }
      });

      const text = response.text || "{}";
      console.log("Raw text response from Gemini chat model:", text);

      let parsed: any = {};
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        // Fallback cleanup
        let cleaned = text.trim();
        if (cleaned.startsWith("```json")) {
          cleaned = cleaned.replace(/^```json/, "").replace(/```$/, "").trim();
        } else if (cleaned.startsWith("```")) {
          cleaned = cleaned.replace(/^```/, "").replace(/```$/, "").trim();
        }
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          parsed = { reply: text, card: null, action: null };
        }
      }

      res.json(parsed);
    } catch (err: any) {
      console.error("Text chat message endpoint failed:", err);
      res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

  app.post("/api/analyze-image", async (req, res) => {
    try {
      const { image, mimeType } = req.body;
      if (!image) {
        return res.status(400).json({ error: "Nebyl poskytnut žádný obrázek" });
      }

      // Strip potential base64 HTML data-url prefix
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const finalMimeType = mimeType || "image/jpeg";

      console.log("Analyzing uploaded image using gemini-flash-latest...");
      
      const activeAi = await getAiClient();
      const response = await activeAi.models.generateContent({
        model: "gemini-flash-latest",
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: finalMimeType
            }
          },
          "Analyzuj tento obrázek (může to být učebnice, sešit, graf, tabulka nebo napsaný příklad) a vytvoř z něj přehledný, stručný studijní tahák (cheat sheet) v češtině. Výsledek vrať VÝHRADNĚ jako platný JSON objekt se třemi klíči: 'topic' (velmi stručný a výstižný název tématu odpovídající obsahu, například 'Lineární rovnice' nebo 'Slovní zásoba: Jídlo'), 'content' (přehledný obsah ve formě 4 až 6 bodů formátovaných v češtině pomocí Markdown s odrážkami a tučnými slovy) a 'subject' (krátký název školního předmětu, například 'Matematika', 'Chemie', 'Biologie', 'Informatika', 'Dějepis', 'Čeština', 'Cizí jazyky'). Nevracej žádný jiný text, žádné ```json formátování okolo, jen čistý validní JSON objekt."
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = response.text || "{}";
      console.log("Gemini image analysis result text:", responseText);

      try {
        const parsed = JSON.parse(responseText);
        res.json({
          topic: parsed.topic || "Studijní materiál z fotky",
          content: parsed.content || "Nepodařilo se vygenerovat přehled z obrázku.",
          subject: parsed.subject || "Všeobecné"
        });
      } catch (parseError) {
        console.error("Failed to parse Gemini output, raw text was:", responseText);
        let cleaned = responseText.trim();
        if (cleaned.startsWith("```json")) {
          cleaned = cleaned.replace(/^```json/, "").replace(/```$/, "").trim();
        } else if (cleaned.startsWith("```")) {
          cleaned = cleaned.replace(/^```/, "").replace(/```$/, "").trim();
        }
        try {
          const parsed = JSON.parse(cleaned);
          res.json({
            topic: parsed.topic || "Studijní materiál z fotky",
            content: parsed.content || "Nepodařilo se vygenerovat přehled z obrázku.",
            subject: parsed.subject || "Všeobecné"
          });
        } catch {
          res.json({
            topic: "Analýza obrázku",
            content: responseText,
            subject: "Všeobecné"
          });
        }
      }
    } catch (err: any) {
      console.error("Failed to analyze image:", err);
      res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

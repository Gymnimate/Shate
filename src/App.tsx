import { useEffect, useRef, useState, FormEvent, TouchEvent, MouseEvent, DragEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Smartphone, Mic, PhoneOff, Sparkles, X, History, ChevronLeft, ChevronRight, ArrowLeft, LogIn, Clock, Settings, LogOut, Sliders, Zap, Key, AlertCircle, Plus, Trash2, Edit, BookOpen, MessageSquare, File, UploadCloud, Check, Folder, FolderOpen, FolderPlus, FilePlus, ChevronDown } from "lucide-react";
import { pcmToBase64, base64ToFloat32 } from "./lib/audio-utils";
import { collection, addDoc, query, where, orderBy, onSnapshot, deleteDoc, doc, serverTimestamp, updateDoc, setDoc, getDoc } from "firebase/firestore";
import { db, auth } from "./lib/firebase";
import { onAuthStateChanged, signInWithPopup, signInAnonymously, GoogleAuthProvider, signOut, User } from "firebase/auth";
import PhotoManager from "./components/PhotoManager";
import MarkdownRenderer from "./components/MarkdownRenderer";
import FileUploader from "./components/FileUploader";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface StudyCardDoc {
  id: string;
  topic: string;
  content: string;
  subject?: string;
  osnova?: string;
  lessonPlan?: string[] | null;
  lessonIndex?: number | null;
  createdAt: any;
  userId: string;
}

interface NoteTabProps {
  key?: string;
  note: { id: string; title: string; content: string };
  isActive: boolean;
  onSelect: () => void | Promise<void>;
  onDelete: (e: any) => void | Promise<void>;
  onRename: (newTitle: string) => void | Promise<void>;
  canDelete: boolean;
}

const NoteTabItem = ({ note, isActive, onSelect, onDelete, onRename, canDelete }: NoteTabProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(note.title);

  useEffect(() => {
    setEditVal(note.title);
  }, [note.title]);

  const handleSave = () => {
    if (editVal.trim() && editVal !== note.title) {
      onRename(editVal);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-zinc-800 border border-indigo-500/30 text-[10px] text-zinc-100 shrink-0 select-text">
        <input
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") {
              setEditVal(note.title);
              setIsEditing(false);
            }
          }}
          className="bg-transparent border-none outline-none text-zinc-100 text-[10px] w-20 p-0 focus:ring-0 uppercase font-mono font-bold"
          autoFocus
          onBlur={handleSave}
        />
        <button onClick={handleSave} className="text-emerald-400 hover:text-emerald-300 p-0.5 cursor-pointer flex items-center justify-center">
          <Check className="w-2.5 h-2.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-1.5 px-3 py-1 rounded-lg border text-[10px] uppercase font-mono font-bold tracking-wider transition-all cursor-pointer whitespace-nowrap shrink-0 relative ${
        isActive
          ? "bg-indigo-950/20 border-indigo-500/30 text-indigo-300 shadow-[0_0_12px_rgba(79,95,247,0.08)] bg-gradient-to-r from-indigo-950/10 via-indigo-950/20 to-indigo-950/15"
          : "bg-transparent border-transparent text-zinc-500 hover:text-zinc-350 hover:border-white/[4%] hover:bg-white/[0.01]"
      }`}
    >
      <span onDoubleClick={() => setIsEditing(true)}>{note.title}</span>
      
      {/* Edit Trigger */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsEditing(true);
        }}
        className="opacity-0 group-hover:opacity-100 text-zinc-550 hover:text-zinc-300 transition-opacity p-0.5 flex items-center justify-center"
        title="Přejmenovat poznámku"
      >
        <Edit className="w-2.5 h-2.5" />
      </button>

      {/* Delete Trigger */}
      {canDelete && (
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-zinc-550 hover:text-red-400 transition-opacity p-0.5 flex items-center justify-center"
          title="Smazat tuto stránku"
        >
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
};

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [assistantTranscriptReal, setAssistantTranscriptActive] = useState<string>("");
  const [userTranscriptReal, setUserTranscriptActive] = useState<string>("");
  const assistantTranscriptRef = useRef("");
  const userTranscriptRef = useRef("");

  const setAssistantTranscript = (val: string | ((prev: string) => string)) => {
    if (typeof val === "function") {
      setAssistantTranscriptActive(prev => {
        const next = val(prev);
        assistantTranscriptRef.current = next;
        return next;
      });
    } else {
      setAssistantTranscriptActive(val);
      assistantTranscriptRef.current = val;
    }
  };

  const setUserTranscript = (val: string | ((prev: string) => string)) => {
    if (typeof val === "function") {
      setUserTranscriptActive(prev => {
        const next = val(prev);
        userTranscriptRef.current = next;
        return next;
      });
    } else {
      setUserTranscriptActive(val);
      userTranscriptRef.current = val;
    }
  };

  // Keep references
  const assistantTranscript = assistantTranscriptReal;
  const userTranscript = userTranscriptReal;

  const [status, setStatus] = useState<string>("Připraveno");
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [voiceSpeed, setVoiceSpeed] = useState<number>(1.4); // Rychlejší řeč o ~40% ve výchozím nastavení

  // Authentication State
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Gemini API Key Dynamic Sharing State
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [isStoringKey, setIsStoringKey] = useState(false);
  const [storedApiKeyExists, setStoredApiKeyExists] = useState(false);
  const [storedApiKeyMasked, setStoredApiKeyMasked] = useState("");

  // User profile / Personalization description
  const [userProfileMemo, setUserProfileMemo] = useState<string>("");
  const [isSavingProfileMemo, setIsSavingProfileMemo] = useState<boolean>(false);
  const userProfileMemoRef = useRef<string>("");
  useEffect(() => {
    userProfileMemoRef.current = userProfileMemo;
  }, [userProfileMemo]);

  // History state management
  const [showSettings, setShowSettings] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [savedCards, setSavedCards] = useState<StudyCardDoc[]>([]);
  const [activePanelType, setActivePanelType] = useState<'general' | 'morning' | 'evening'>('general');
  const DEFAULT_MORNING_ROUTINE = "### Ranní rutina ☀️\n";
  const DEFAULT_EVENING_ROUTINE = "### Večerní rutina 🌙\n";
  const [showHistory, setShowHistory] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [userId, setUserId] = useState<string>("");
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedOsnova, setSelectedOsnova] = useState<string | null>(null);

  // Research states
  const [researchTopic, setResearchTopic] = useState<string>("");
  const [researchStatus, setResearchStatus] = useState<"idle" | "searching" | "ready">("idle");
  const [researchResult, setResearchResult] = useState<string>("");
  const [researchSources, setResearchSources] = useState<Array<{ title: string; url: string }>>([]);
  const [researchSubject, setResearchSubject] = useState<string>("Denní plán");

  // Custom helper card state
  const [customCard, setCustomCard] = useState<{ topic: string; content: string; subject?: string } | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const prevSavedCardsLengthRef = useRef<number>(0);

  // Text message chat states
  const [textMessage, setTextMessage] = useState("");
  const [attachedFile, setAttachedFile] = useState<{
    name: string;
    type: string;
    size: number;
    base64?: string;
    textContent?: string;
  } | null>(null);
  const [isSubmittingText, setIsSubmittingText] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);

  // Unified chat history for current session
  const [chatHistory, setChatHistory] = useState<Array<{ id: string; userText?: string; assistantText?: string; timestamp: Date }>>([]);
  
  // Chat sessions state
  const [chats, setChats] = useState<any[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  const chatsRef = useRef<any[]>([]);
  chatsRef.current = chats;

  const activeChatIdRef = useRef<string | null>(null);
  activeChatIdRef.current = activeChatId;

  const activeNoteIdRef = useRef<string | null>(null);
  activeNoteIdRef.current = activeNoteId;
  const [mobileTab, setMobileTab] = useState<'chats' | 'plan' | 'chatbot'>('chatbot');
  const [isEditingPlan, setIsEditingPlan] = useState(false);
  const [editingPlanContent, setEditingPlanContent] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [localModernContent, setLocalModernContent] = useState("");
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isNotesFocused, setIsNotesFocused] = useState(false);
  const [isRenamingActiveNote, setIsRenamingActiveNote] = useState(false);

  // Folder UI states
  const [creatingFolderInId, setCreatingFolderInId] = useState<string | null>(null);
  const [newFolderTitleInput, setNewFolderTitleInput] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderInput, setRenameFolderInput] = useState("");

  // Custom dialog states to replace blocked window.confirm and alert APIs inside iframes
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [alertDialog, setAlertDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Desktop layout detection
  useEffect(() => {
    const checkWidth = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);
  const [permissionError, setPermissionError] = useState<{
    type: "mic" | "camera" | "general";
    message: string;
  } | null>(null);

  const isNewTurnRef = useRef<boolean>(true);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mobileTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Configuration
  const SAMPLE_RATE = 16000;

  // Monitor standard Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setUserId(currentUser.uid);
      } else {
        setUserId("");
      }
    });
    return () => unsubscribe();
  }, []);

  // Listen to Firestore for user description/preferences profile memo
  useEffect(() => {
    if (!userId) {
      setUserProfileMemo("");
      return;
    }
    const unsub = onSnapshot(doc(db, "users", userId), (snapshot) => {
      try {
        if (snapshot.exists()) {
          const val = snapshot.data();
          if (val && val.profileMemo !== undefined) {
            setUserProfileMemo(val.profileMemo || "");
          }
        }
      } catch (err) {
        console.error("Failed to fetch user profile memo from Firestore:", err);
      }
    });
    return () => unsub();
  }, [userId]);

  const saveUserProfileMemo = async (newMemo: string) => {
    if (!userId) return;
    setIsSavingProfileMemo(true);
    try {
      await setDoc(doc(db, "users", userId), { profileMemo: newMemo }, { merge: true });
    } catch (err) {
      console.error("Error saving user profile memo:", err);
    } finally {
      setIsSavingProfileMemo(false);
    }
  };

  // Listen to Firestore for shared Gemini API key updates
  useEffect(() => {
    if (!user) {
      setStoredApiKeyExists(false);
      setStoredApiKeyMasked("");
      return;
    }
    const unsub = onSnapshot(doc(db, "settings", "gemini"), (snapshot) => {
      try {
        if (snapshot.exists()) {
          const val = snapshot.data();
          setStoredApiKeyExists(true);
          if (val && val.apiKey) {
            const keyStr = val.apiKey;
            if (keyStr.length > 10) {
              setStoredApiKeyMasked(keyStr.slice(0, 7) + "..." + keyStr.slice(-4));
            } else {
              setStoredApiKeyMasked("Aktivní");
            }
          }
        } else {
          setStoredApiKeyExists(false);
          setStoredApiKeyMasked("");
        }
      } catch (err) {
        console.error("Failed to fetch settings from Firestore:", err);
      }
    }, (error) => {
      console.warn("Permission restricted or failed checking settings document:", error);
    });
    return () => unsub();
  }, [user]);

  const loginWithGoogle = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setStatus("Přihlášení úspěšné");
    } catch (err: any) {
      console.error("Google Auth Error:", err);
      if (err?.code === "auth/popup-closed-by-user" || err?.message?.includes("popup-closed-by-user")) {
        setAuthError("Přihlašovací okno bylo zavřeno nebo zablokováno prohlížečem. Pokud používáš Google AI Studio náhled, doporučujeme aplikaci otevřít na nové samostatné kartě kliknutím na ikonu šipky v pravém horním rohu náhledu. Případně můžeš pokračovat jako host.");
      } else {
        setAuthError("Nepodařilo se přihlásit přes Google. Zkuste přihlášení na samostatné kartě nebo pokračujte jako host.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };



  const loginAsGuest = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      await signInAnonymously(auth);
      setStatus("Přihlášen jako host");
    } catch (err: any) {
      console.error("Guest Auth Error:", err);
      const virtualId = "guest_" + Math.random().toString(36).substring(2, 10);
      setUserId(virtualId);
      setUser({
        uid: virtualId,
        displayName: "Testovací Host",
        email: "host@shate.ai",
        isAnonymous: true,
      } as any);
      setStatus("Přihlášen jako host (offline)");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setUserId("");
      setSelectedSubject(null);
      setActiveCardId(null);
      setCustomCard(null);
      setStatus("Odhlášeno");
    } catch (err) {
      console.error("Signout Error:", err);
    }
  };

  const handleSaveApiKey = async () => {
    if (!geminiApiKey.trim()) return;
    setIsStoringKey(true);
    try {
      await setDoc(doc(db, "settings", "gemini"), {
        apiKey: geminiApiKey.trim(),
        updatedAt: new Date().toISOString(),
        updatedBy: user ? user.uid : "anonymous"
      });
      setGeminiApiKey("");
      setStatus("Gemini API klíč úspěšně uložen pro všechny");
    } catch (err) {
      console.error("Failed to store API key in Firestore:", err);
      setStatus("Chyba při ukládání klíče");
    } finally {
      setIsStoringKey(false);
    }
  };

  // Listen for saved study cards in real-time
  useEffect(() => {
    if (!userId) return;

    const q = query(
      collection(db, "study-cards"),
      where("userId", "==", userId),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: StudyCardDoc[] = [];
      snapshot.forEach((snap) => {
        const data = snap.data();
        list.push({
          id: snap.id,
          topic: data.topic || "Denní plán",
          content: data.content || "",
          subject: data.subject || "Denní plán",
          osnova: data.osnova || "",
          lessonPlan: data.lessonPlan || null,
          lessonIndex: data.lessonIndex || null,
          createdAt: data.createdAt,
          userId: data.userId,
          targetDateStr: data.targetDateStr || null
        } as any);
      });
      setSavedCards(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "study-cards");
    });

    return () => unsubscribe();
  }, [userId]);

  // Listen for chats in real-time
  useEffect(() => {
    if (!userId) {
      setChats([]);
      return;
    }

    const q = query(
      collection(db, "chats"),
      where("userId", "==", userId),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((snap) => {
        const data = snap.data();
        list.push({
          id: snap.id,
          userId: data.userId,
          title: data.title || "Nový chat",
          createdAt: data.createdAt,
          messages: data.messages || [],
          studyCardId: data.studyCardId || null,
          modernSpaceContent: data.modernSpaceContent ?? "",
          notes: data.notes || [],
          activeNoteId: data.activeNoteId || null,
          folders: data.folders || []
        });
      });

      setChats(list);

      // Auto-select first chat if none is active
      if (list.length > 0 && !activeChatId) {
        const storedActiveId = sessionStorage.getItem(`active_chat_id_${userId}`);
        if (storedActiveId && list.some(c => c.id === storedActiveId)) {
          setActiveChatId(storedActiveId);
        } else {
          setActiveChatId(list[0].id);
        }
      }
    }, (error) => {
      console.error("Chats subscription failed:", error);
    });

    return () => unsubscribe();
  }, [userId]);

  // Save active chat selection to session storage to persist across refresh
  useEffect(() => {
    if (userId && activeChatId) {
      sessionStorage.setItem(`active_chat_id_${userId}`, activeChatId);
    }
  }, [activeChatId, userId]);

  // Create default chat for user if empty
  useEffect(() => {
    if (userId && chats.length === 0 && !isLoggingIn) {
      const timer = setTimeout(() => {
        if (chats.length === 0) {
          createNewChatSession("Moje první učení 🧠");
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [userId, chats.length, isLoggingIn]);

  // Load selected chat content when activeChatId changes
  useEffect(() => {
    if (activeChatId && chats.length > 0) {
      const activeChat = chats.find(c => c.id === activeChatId);
      if (activeChat) {
        const msgs = (activeChat.messages || []).map((m: any) => ({
          ...m,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date()
        }));
        setChatHistory(msgs);
        if (activeChat.studyCardId) {
          setActiveCardId(activeChat.studyCardId);
        } else {
          setActiveCardId(null);
        }
      }
    } else {
      setChatHistory([]);
      setActiveCardId(null);
    }
  }, [activeChatId, chats]);

  // Get notes list for the current active chat (handles fallback for older sessions)
  const getNotesForCurrentChat = (): Array<{ id: string; title: string; content: string }> => {
    if (!activeChatId) return [];
    const activeChat = chats.find(c => c.id === activeChatId);
    if (!activeChat) return [];
    if (activeChat.notes && activeChat.notes.length > 0) {
      return activeChat.notes;
    }
    return [
      {
        id: "default",
        title: "Hlavní poznámka",
        content: activeChat.modernSpaceContent || ""
      }
    ];
  };

  // Recursively render folder and note hierarchy tree
  const renderFolderTree = (pId: string | null = null, depth: number = 0) => {
    const activeChat = chats.find(c => c.id === activeChatId);
    if (!activeChat) return null;

    const currentFolders = (activeChat.folders || []).filter((f: any) => (f.parentId || null) === (pId || null));
    const currentNotes = getNotesForCurrentChat().filter((n: any) => {
      const fId = n.folderId || null;
      return fId === (pId || null);
    });

    if (currentFolders.length === 0 && currentNotes.length === 0) return null;

    return (
      <div className="space-y-1">
        {currentFolders.map((folder: any) => {
          const isCollapsed = !!folder.isCollapsed;
          const isRenaming = renamingFolderId === folder.id;
          const isCreatingSub = creatingFolderInId === folder.id;

          return (
            <div key={folder.id} className="space-y-1">
              {/* Folder Row */}
              <div
                draggable="true"
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", folder.id);
                  e.dataTransfer.setData("type", "folder");
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const draggedId = e.dataTransfer.getData("text/plain");
                  const draggedType = e.dataTransfer.getData("type");
                  if (draggedType === "note") {
                    moveNoteToFolder(draggedId, folder.id);
                  } else if (draggedType === "folder") {
                    moveFolderToFolder(draggedId, folder.id);
                  }
                }}
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
                className="group flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[3%] transition-all text-zinc-300 hover:text-white"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <button
                    onClick={() => toggleFolderCollapse(folder.id)}
                    className="p-0.5 text-zinc-550 hover:text-zinc-300 rounded cursor-pointer shrink-0"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                  </button>
                  {isCollapsed ? (
                    <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0 fill-amber-500/10" />
                  ) : (
                    <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0 fill-amber-400/10" />
                  )}

                  {isRenaming ? (
                    <input
                      value={renameFolderInput}
                      onChange={(e) => setRenameFolderInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          renameFolder(folder.id, renameFolderInput);
                          setRenamingFolderId(null);
                        }
                        if (e.key === "Escape") setRenamingFolderId(null);
                      }}
                      onBlur={() => {
                        renameFolder(folder.id, renameFolderInput);
                        setRenamingFolderId(null);
                      }}
                      className="bg-zinc-900 border border-[#4f5ff7]/40 focus:outline-none focus:ring-1 focus:ring-[#4f5ff7] rounded px-1.5 py-0.5 text-xs text-zinc-100 font-medium flex-1 max-w-[120px]"
                      autoFocus
                    />
                  ) : (
                    <span
                      onDoubleClick={() => {
                        setRenameFolderInput(folder.title);
                        setRenamingFolderId(folder.id);
                      }}
                      className="text-xs font-semibold truncate cursor-pointer select-none"
                    >
                      {folder.title}
                    </span>
                  )}
                </div>

                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => {
                      setNewFolderTitleInput("");
                      setCreatingFolderInId(folder.id);
                    }}
                    className="p-1 hover:bg-white/[5%] hover:text-[#00d2ff] rounded transition-all cursor-pointer"
                    title="Nová podsložka"
                  >
                    <FolderPlus className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => createNewNote(folder.id)}
                    className="p-1 hover:bg-white/[5%] hover:text-[#00d2ff] rounded transition-all cursor-pointer"
                    title="Nová poznámka"
                  >
                    <FilePlus className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => {
                      setRenameFolderInput(folder.title);
                      setRenamingFolderId(folder.id);
                    }}
                    className="p-1 hover:bg-white/[5%] hover:text-[#00d2ff] rounded transition-all cursor-pointer"
                    title="Přejmenovat složku"
                  >
                    <Edit className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => deleteFolder(folder.id, e as any)}
                    className="p-1 hover:bg-white/[5%] hover:text-rose-400 rounded transition-all cursor-pointer"
                    title="Smazat složku"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {isCreatingSub && (
                <div style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }} className="flex items-center gap-2 py-1">
                  <FolderPlus className="w-3.5 h-3.5 text-amber-500/60" />
                  <input
                    value={newFolderTitleInput}
                    onChange={(e) => setNewFolderTitleInput(e.target.value)}
                    placeholder="Název podsložky..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (newFolderTitleInput.trim()) {
                          createFolder(newFolderTitleInput.trim(), folder.id);
                        }
                        setCreatingFolderInId(null);
                      }
                      if (e.key === "Escape") setCreatingFolderInId(null);
                    }}
                    onBlur={() => {
                      if (newFolderTitleInput.trim()) {
                        createFolder(newFolderTitleInput.trim(), folder.id);
                      }
                      setCreatingFolderInId(null);
                    }}
                    className="bg-black/40 border border-white/[10%] focus:border-[#4f5ff7]/40 focus:outline-none rounded px-1.5 py-0.5 text-xs text-zinc-300 flex-1 max-w-[130px]"
                    autoFocus
                  />
                </div>
              )}

              {!isCollapsed && (
                <div className="space-y-1">
                  {renderFolderTree(folder.id, depth + 1)}
                </div>
              )}
            </div>
          );
        })}

        {currentNotes.map((note: any) => {
          const isActive = note.id === activeNoteId;
          return (
            <div
              key={note.id}
              draggable="true"
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", note.id);
                e.dataTransfer.setData("type", "note");
              }}
              style={{ paddingLeft: `${depth * 12 + 26}px` }}
              onClick={async () => {
                if (activeNoteId !== note.id) {
                  if (activeNoteId && activeChat) {
                    const currentNotesList = getNotesForCurrentChat();
                    const updatedNotes = currentNotesList.map(n => {
                      if (n.id === activeNoteId) {
                        return { ...n, content: localModernContent };
                      }
                      return n;
                    });
                    await updateDoc(doc(db, "chats", activeChatId), {
                      notes: updatedNotes
                    });
                  }
                  setActiveNoteId(note.id);
                  setLocalModernContent(note.content || "");
                }
              }}
              className={`group flex items-center justify-between py-1 px-2 rounded-lg cursor-pointer transition-all ${
                isActive
                  ? "bg-indigo-950/20 border border-indigo-500/20 text-white"
                  : "bg-transparent border border-transparent text-zinc-400 hover:bg-white/[1.5%] hover:text-zinc-200"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <File className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-[#00d2ff]" : "text-zinc-550 group-hover:text-zinc-400"}`} />
                <span className="text-xs truncate font-medium">{note.title}</span>
              </div>

              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNote(note.id, e as any);
                  }}
                  className="p-0.5 hover:bg-white/[5%] hover:text-rose-400 rounded transition-all cursor-pointer"
                  title="Smazat poznámku"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Get displayed title of a chat (dynamically named after the active note inside that chat)
  const getChatDisplayTitle = (chat: any): string => {
    if (!chat) return "Nová konverzace";
    if (chat.notes && chat.notes.length > 0) {
      const actId = chat.activeNoteId || "default";
      const found = chat.notes.find((n: any) => n.id === actId) || chat.notes[0];
      if (found && found.title) return found.title;
    }
    return chat.title || "Hlavní poznámka";
  };

  const getNotesForChatRef = (chatId: string | null) => {
    if (!chatId) return [];
    const chat = chatsRef.current.find(c => c.id === chatId);
    if (!chat) return [];
    if (chat.notes && chat.notes.length > 0) {
      return chat.notes;
    }
    return [
      {
        id: "default",
        title: "Hlavní poznámka",
        content: chat.modernSpaceContent || ""
      }
    ];
  };

  // Switch to another note inside the active chat
  const changeActiveNote = async (noteId: string) => {
    if (!activeChatId) return;
    try {
      await saveModernSpace(localModernContent);
      const activeChat = chats.find(c => c.id === activeChatId);
      if (!activeChat) return;
      
      let currentNotes: Array<{ id: string; title: string; content: string }> = [];
      if (activeChat.notes && activeChat.notes.length > 0) {
        currentNotes = [...activeChat.notes];
      } else {
        currentNotes = [
          {
            id: "default",
            title: "Hlavní poznámka",
            content: activeChat.modernSpaceContent || ""
          }
        ];
      }

      const targetNote = currentNotes.find(n => n.id === noteId);
      if (targetNote) {
        setActiveNoteId(noteId);
        setLocalModernContent(targetNote.content || "");
        await updateDoc(doc(db, "chats", activeChatId), {
          activeNoteId: noteId
        });
      }
    } catch (err) {
      console.error("Error switching note:", err);
    }
  };

  // Create a new note page in the current chat
  const createNewNote = async (folderId: string | null = null) => {
    if (!activeChatId) return;
    try {
      const activeChat = chats.find(c => c.id === activeChatId);
      if (!activeChat) return;

      let currentNotes: Array<{ id: string; title: string; content: string; folderId?: string | null }> = [];
      if (activeChat.notes && activeChat.notes.length > 0) {
        currentNotes = [...activeChat.notes];
      } else {
        currentNotes = [
          {
            id: "default",
            title: "Hlavní poznámka",
            content: activeChat.modernSpaceContent || "",
            folderId: null
          }
        ];
      }

      // First, update the active note's content locally in our array
      const currActiveId = activeNoteId || "default";
      currentNotes = currentNotes.map(n => {
        if (n.id === currActiveId) {
          return { ...n, content: localModernContent };
        }
        return n;
      });

      // Prepare new note
      const nextNum = currentNotes.length + 1;
      const newId = `note_${Date.now()}`;
      const newNote = {
        id: newId,
        title: `Poznámka ${nextNum}`,
        content: "",
        folderId: folderId
      };

      const updatedNotes = [...currentNotes, newNote];

      // Update Firestore in one atomic transaction/call
      await updateDoc(doc(db, "chats", activeChatId), {
        notes: updatedNotes,
        activeNoteId: newId,
        title: newNote.title,
        modernSpaceContent: updatedNotes.find(n => n.id === "default")?.content || ""
      });

      setActiveNoteId(newId);
      setLocalModernContent("");
      setStatus("Vytvořena " + newNote.title);
    } catch (err) {
      console.error("Error creating note:", err);
      setStatus("Chyba při vytvoření poznámky");
    }
  };

  // Delete a note page in the current active chat
  const deleteNote = async (noteId: string, e: MouseEvent) => {
    e.stopPropagation();
    if (!activeChatId) return;

    const activeChat = chats.find(c => c.id === activeChatId);
    if (!activeChat) return;

    let currentNotes: Array<{ id: string; title: string; content: string }> = [];
    if (activeChat.notes && activeChat.notes.length > 0) {
      currentNotes = [...activeChat.notes];
    } else {
      currentNotes = [
        {
          id: "default",
          title: "Hlavní poznámka",
          content: activeChat.modernSpaceContent || ""
        }
      ];
    }

    if (currentNotes.length <= 1) {
      setAlertDialog({
        isOpen: true,
        title: "Nelze smazat",
        message: "Nemůžete smazat poslední poznámku."
      });
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: "Smazat poznámku",
      message: "Opravdu chcete smazat tuto poznámku?",
      onConfirm: async () => {
        try {
          const idx = currentNotes.findIndex(n => n.id === noteId);
          const updatedNotes = currentNotes.filter(n => n.id !== noteId);

          let newActiveId = activeNoteId;
          if (activeNoteId === noteId) {
            const fallbackNote = currentNotes[idx === 0 ? 1 : idx - 1];
            newActiveId = fallbackNote.id;
          }

          const updateFields: any = {
            notes: updatedNotes,
            activeNoteId: newActiveId
          };

          const fallbackNoteObj = updatedNotes.find(n => n.id === newActiveId);
          const isDefault = newActiveId === "default" || newActiveId === updatedNotes[0]?.id;
          if (isDefault) {
            updateFields.modernSpaceContent = fallbackNoteObj?.content || "";
          }

          await updateDoc(doc(db, "chats", activeChatId), updateFields);

          if (activeNoteId === noteId) {
            setActiveNoteId(newActiveId);
            setLocalModernContent(fallbackNoteObj?.content || "");
          }
          setStatus("Poznámka smazána");
        } catch (err) {
          console.error("Error deleting note:", err);
          setStatus("Chyba při mazání");
        }
      }
    });
  };

  // Rename a note page title in the current active chat
  const renameNote = async (noteId: string, newTitle: string) => {
    if (!activeChatId || !newTitle.trim()) return;
    try {
      const activeChat = chats.find(c => c.id === activeChatId);
      if (!activeChat) return;

      let currentNotes: Array<{ id: string; title: string; content: string }> = [];
      if (activeChat.notes && activeChat.notes.length > 0) {
        currentNotes = [...activeChat.notes];
      } else {
        currentNotes = [
          {
            id: "default",
            title: "Hlavní poznámka",
            content: activeChat.modernSpaceContent || ""
          }
        ];
      }

      const updatedNotes = currentNotes.map(n => {
        if (n.id === noteId) {
          return { ...n, title: newTitle.trim() };
        }
        return n;
      });

      const isEditingActive = (activeNoteId || "default") === noteId;
      const updateFields: any = {
        notes: updatedNotes
      };
      if (isEditingActive) {
        updateFields.title = newTitle.trim();
      }

      await updateDoc(doc(db, "chats", activeChatId), updateFields);
      setStatus("Přejmenováno");
    } catch (err) {
      console.error("Error renaming note:", err);
    }
  };

  // Create a new folder
  const createFolder = async (title: string, parentId: string | null = null) => {
    if (!activeChatId || !title.trim()) return;
    try {
      const activeChat = chats.find(c => c.id === activeChatId);
      if (!activeChat) return;
      const currentFolders = activeChat.folders || [];
      const newFolder = {
        id: `folder_${Date.now()}`,
        title: title.trim(),
        parentId: parentId,
        isCollapsed: false
      };
      await updateDoc(doc(db, "chats", activeChatId), {
        folders: [...currentFolders, newFolder]
      });
      setStatus("Složka vytvořena");
    } catch (err) {
      console.error("Error creating folder:", err);
      setStatus("Chyba při vytváření");
    }
  };

  // Toggle folder collapse state
  const toggleFolderCollapse = async (folderId: string) => {
    if (!activeChatId) return;
    try {
      const activeChat = chats.find(c => c.id === activeChatId);
      if (!activeChat) return;
      const currentFolders = activeChat.folders || [];
      const updatedFolders = currentFolders.map((f: any) => {
        if (f.id === folderId) {
          return { ...f, isCollapsed: !f.isCollapsed };
        }
        return f;
      });
      await updateDoc(doc(db, "chats", activeChatId), {
        folders: updatedFolders
      });
    } catch (err) {
      console.error("Error toggling folder:", err);
    }
  };

  // Rename a folder
  const renameFolder = async (folderId: string, newTitle: string) => {
    if (!activeChatId || !newTitle.trim()) return;
    try {
      const activeChat = chats.find(c => c.id === activeChatId);
      if (!activeChat) return;
      const currentFolders = activeChat.folders || [];
      const updatedFolders = currentFolders.map((f: any) => {
        if (f.id === folderId) {
          return { ...f, title: newTitle.trim() };
        }
        return f;
      });
      await updateDoc(doc(db, "chats", activeChatId), {
        folders: updatedFolders
      });
      setStatus("Složka přejmenována");
    } catch (err) {
      console.error("Error renaming folder:", err);
      setStatus("Chyba při přejmenování");
    }
  };

  // Delete a folder
  const deleteFolder = async (folderId: string, e: MouseEvent) => {
    e.stopPropagation();
    if (!activeChatId) return;
    const activeChat = chats.find(c => c.id === activeChatId);
    if (!activeChat) return;

    setConfirmDialog({
      isOpen: true,
      title: "Smazat složku",
      message: "Opravdu chcete smazat tuto složku? Poznámky uvnitř budou přesunuty do hlavní úrovně.",
      onConfirm: async () => {
        try {
          // Remove the folder
          const currentFolders = activeChat.folders || [];
          const updatedFolders = currentFolders.filter((f: any) => f.id !== folderId);

          // Move all child notes and subfolders to root (or parent of this folder)
          const currentFolder = currentFolders.find((f: any) => f.id === folderId);
          const newParentId = currentFolder?.parentId || null;

          // Update child subfolders
          const updatedFoldersFinal = updatedFolders.map((f: any) => {
            if (f.parentId === folderId) {
              return { ...f, parentId: newParentId };
            }
            return f;
          });

          // Update notes inside this folder to move to parent/root
          const currentNotes = getNotesForCurrentChat();
          const updatedNotes = currentNotes.map((n: any) => {
            if (n.folderId === folderId) {
              return { ...n, folderId: newParentId };
            }
            return n;
          });

          await updateDoc(doc(db, "chats", activeChatId), {
            folders: updatedFoldersFinal,
            notes: updatedNotes
          });
          setStatus("Složka smazána");
        } catch (err) {
          console.error("Error deleting folder:", err);
          setStatus("Chyba při mazání");
        }
      }
    });
  };

  // Move note to folder
  const moveNoteToFolder = async (noteId: string, folderId: string | null) => {
    if (!activeChatId) return;
    try {
      const currentNotes = getNotesForCurrentChat();
      const updatedNotes = currentNotes.map((n: any) => {
        if (n.id === noteId) {
          return { ...n, folderId: folderId };
        }
        return n;
      });
      await updateDoc(doc(db, "chats", activeChatId), {
        notes: updatedNotes
      });
      setStatus("Poznámka přesunuta");
    } catch (err) {
      console.error("Error moving note:", err);
      setStatus("Chyba při přesouvání");
    }
  };

  // Move folder to another folder (subfolder)
  const moveFolderToFolder = async (folderId: string, parentId: string | null) => {
    if (!activeChatId) return;
    // Prevent cycles
    if (folderId === parentId) return;
    try {
      const activeChat = chats.find(c => c.id === activeChatId);
      if (!activeChat) return;
      const currentFolders = activeChat.folders || [];
      const updatedFolders = currentFolders.map((f: any) => {
        if (f.id === folderId) {
          return { ...f, parentId: parentId };
        }
        return f;
      });
      await updateDoc(doc(db, "chats", activeChatId), {
        folders: updatedFolders
      });
      setStatus("Složka přesunuta");
    } catch (err) {
      console.error("Error moving folder:", err);
      setStatus("Chyba při přesouvání");
    }
  };

  const handlePrevNote = async () => {
    const notes = getNotesForCurrentChat();
    if (notes.length <= 1) return;
    const currentNoteIndex = notes.findIndex(n => n.id === (activeNoteId || "default"));
    const prevIdx = (currentNoteIndex - 1 + notes.length) % notes.length;
    await changeActiveNote(notes[prevIdx].id);
  };

  const handleNextNote = async () => {
    const notes = getNotesForCurrentChat();
    if (notes.length <= 1) return;
    const currentNoteIndex = notes.findIndex(n => n.id === (activeNoteId || "default"));
    const nextIdx = (currentNoteIndex + 1) % notes.length;
    await changeActiveNote(notes[nextIdx].id);
  };

  // Sync DB's active note to localModernContent when DB changes, BUT only if the user is not actively editing
  useEffect(() => {
    if (!activeChatId) return;
    const notes = getNotesForCurrentChat();
    const currActiveId = activeNoteId || "default";
    const activeNote = notes.find(n => n.id === currActiveId) || notes[0];
    const dbContent = activeNote ? (activeNote.content || "") : "";
    
    if (!isNotesFocused) {
      setLocalModernContent(dbContent);
    }
  }, [activeChatId, chats, activeNoteId, isNotesFocused]);

  // Sync selected chat's activeNoteId on activeChatId changes
  useEffect(() => {
    if (activeChatId) {
      const activeChat = chats.find(c => c.id === activeChatId);
      if (activeChat) {
        if (activeChat.activeNoteId) {
          setActiveNoteId(activeChat.activeNoteId);
        } else {
          setActiveNoteId("default");
        }
      }
    } else {
      setActiveNoteId(null);
    }
  }, [activeChatId, chats]);

  // Auto-save localModernContent to Firestore with debounce
  useEffect(() => {
    if (!activeChatId || !isNotesFocused) return;
    const notes = getNotesForCurrentChat();
    const currActiveId = activeNoteId || "default";
    const activeNote = notes.find(n => n.id === currActiveId) || notes[0];
    const dbContent = activeNote ? (activeNote.content || "") : "";
    
    if (localModernContent === dbContent) return;

    const timer = setTimeout(() => {
      saveModernSpace(localModernContent);
    }, 1000);

    return () => clearTimeout(timer);
  }, [localModernContent, activeChatId, activeNoteId, isNotesFocused]);

  const handleNotesBlur = () => {
    setIsNotesFocused(false);
    saveModernSpace(localModernContent);
  };

  const saveModernSpace = async (newContent: string) => {
    if (!activeChatId) return;
    try {
      const notes = getNotesForCurrentChat();
      const currActiveId = activeNoteId || "default";
      
      const updatedNotes = notes.map(n => {
        if (n.id === currActiveId) {
          return { ...n, content: newContent };
        }
        return n;
      });

      const isDefault = currActiveId === "default" || currActiveId === notes[0]?.id;
      const updateFields: any = {
        notes: updatedNotes,
        activeNoteId: currActiveId
      };
      if (isDefault) {
        updateFields.modernSpaceContent = newContent;
      }

      await updateDoc(doc(db, "chats", activeChatId), updateFields);
    } catch (err) {
      console.error("Error saving modern space content:", err);
      setStatus("Chyba při ukládání");
    }
  };

  const createNewChatSession = async (customTitle?: string) => {
    if (!userId) return;
    setStatus("Vytvářím nový chat...");
    try {
      const docRef = await addDoc(collection(db, "chats"), {
        userId: userId,
        title: customTitle || "Hlavní poznámka",
        messages: [],
        studyCardId: null,
        modernSpaceContent: "",
        createdAt: serverTimestamp()
      });
      setActiveChatId(docRef.id);
      setChatHistory([]);
      setActiveCardId(null);
      setCustomCard(null);
      setStatus("Nový chat vytvořen");
    } catch (err) {
      console.error("Failed to create new chat session:", err);
      setStatus("Chyba při vytvoření chatu");
    }
  };

  const deleteChatSession = async (chatId: string, e?: MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }

    setConfirmDialog({
      isOpen: true,
      title: "Smazat konverzaci",
      message: "Opravdu chcete smazat tento rozhovor?",
      onConfirm: async () => {
        try {
          setStatus("Mažu chat...");
          
          // Cleanup loaded ID if we are deleting the active chat
          if (activeChatId === chatId) {
            setActiveChatId(null);
            setActiveCardId(null);
            if (userId) {
              sessionStorage.removeItem(`active_chat_id_${userId}`);
            }
          }
          
          // Clean up study card if present
          const targetChat = chats.find(c => c.id === chatId);
          if (targetChat?.studyCardId) {
            await deleteDoc(doc(db, "study-cards", targetChat.studyCardId));
          }

          await deleteDoc(doc(db, "chats", chatId));
          setStatus("Smazáno");
        } catch (err) {
          console.error("Failed to delete chat:", err);
          setStatus("Chyba při mazání");
        }
      }
    });
  };

  const saveEditedPlan = async () => {
    if (activeCard && activeCardId) {
      try {
        setStatus("Ukládám plán...");
        await updateDoc(doc(db, "study-cards", activeCardId), {
          content: editingPlanContent,
          updatedAt: serverTimestamp()
        });
        setIsEditingPlan(false);
        setStatus("Plán uložen");
      } catch (err) {
        console.error("Failed to save edited plan:", err);
        setStatus("Chyba při ukládání");
      }
    } else {
      setIsEditingPlan(false);
    }
  };

  // Study plan persistence logic
  const saveStudyPlanToDb = async (topic: string, content: string, osnova?: string) => {
    if (!userId || !activeChatId) return;

    const activeChat = chats.find(c => c.id === activeChatId);
    const currentStudyCardId = activeChat?.studyCardId;

    if (currentStudyCardId) {
      try {
        await updateDoc(doc(db, "study-cards", currentStudyCardId), {
          content: content,
          topic: topic,
          osnova: osnova || "",
          createdAt: serverTimestamp()
        });
        setActiveCardId(currentStudyCardId);
      } catch (error) {
        console.error("Failed to update study plan:", error);
      }
    } else {
      try {
        const docRef = await addDoc(collection(db, "study-cards"), {
          topic: topic,
          content: content,
          subject: "Studijní plán",
          osnova: osnova || "",
          createdAt: serverTimestamp(),
          userId: userId,
          targetDateStr: `chat_linked_${activeChatId}`
        });

        await updateDoc(doc(db, "chats", activeChatId), {
          studyCardId: docRef.id
        });
        setActiveCardId(docRef.id);
      } catch (error) {
        console.error("Failed to save study plan:", error);
      }
    }
  };

  const handleToggleStudyPlanTask = async (lineIndex: number) => {
    if (!activeCardId) return;

    const card = savedCards.find(c => c.id === activeCardId);
    if (!card) return;

    const content = card.content;
    if (!content) return;

    const lines = content.split("\n");
    if (lineIndex < 0 || lineIndex >= lines.length) return;

    const targetLine = lines[lineIndex];
    const isBullet = targetLine.trim().startsWith("- ") || targetLine.trim().startsWith("* ");
    if (!isBullet) return;

    const match = targetLine.match(/^(\s*[-*]\s*)(.*)$/);
    if (!match) return;

    const prefix = match[1];
    const suffix = match[2].trim();

    let newSuffix = "";
    let isNowCompleted = false;

    if (suffix.startsWith("[x]") || suffix.startsWith("[X]")) {
      newSuffix = suffix.substring(3).trim();
      isNowCompleted = false;
    } else if (suffix.startsWith("[ ]")) {
      newSuffix = "[x] " + suffix.substring(3).trim();
      isNowCompleted = true;
    } else {
      newSuffix = "[x] " + suffix;
      isNowCompleted = true;
    }

    lines[lineIndex] = `${prefix.trimEnd()} ${newSuffix}`;

    if (isNowCompleted) {
      const movedLine = lines.splice(lineIndex, 1)[0];
      let lastBulletIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i].trim();
        if (ln.startsWith("- ") || ln.startsWith("* ")) {
          lastBulletIndex = i;
        }
      }
      if (lastBulletIndex !== -1) {
        lines.splice(lastBulletIndex + 1, 0, movedLine);
      } else {
        lines.push(movedLine);
      }
    } else {
      const movedLine = lines.splice(lineIndex, 1)[0];
      let firstCompletedIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i].trim();
        if ((ln.startsWith("- ") || ln.startsWith("* ")) && (ln.includes("[x]") || ln.includes("[X]"))) {
          firstCompletedIndex = i;
          break;
        }
      }
      if (firstCompletedIndex !== -1) {
        lines.splice(firstCompletedIndex, 0, movedLine);
      } else {
        let lastUnfinishedIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i].trim();
          if ((ln.startsWith("- ") || ln.startsWith("* ")) && !ln.includes("[x]") && !ln.includes("[X]")) {
            lastUnfinishedIndex = i;
          }
        }
        if (lastUnfinishedIndex !== -1) {
          lines.splice(lastUnfinishedIndex + 1, 0, movedLine);
        } else {
          lines.push(movedLine);
        }
      }
    }

    const updatedContent = lines.join("\n");
    try {
      await updateDoc(doc(db, "study-cards", activeCardId), {
        content: updatedContent,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Failed to toggle study plan task:", error);
    }
  };

  const getCardDayLabel = (card: any) => {
    if (!card) return "Plán";
    const topicLower = (card.topic || "").toLowerCase();
    if (topicLower.includes("dnes") || topicLower === "dnes") return "Dnes";
    if (topicLower.includes("včera") || topicLower === "včera") return "Včera";
    if (topicLower.includes("zítra") || topicLower === "zítra") return "Zítra";

    if (card.createdAt?.seconds) {
      const cardDate = new Date(card.createdAt.seconds * 1000);
      const today = new Date();
      
      const isSameDay = (d1: Date, d2: Date) => 
        d1.getDate() === d2.getDate() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getFullYear() === d2.getFullYear();

      if (isSameDay(cardDate, today)) return "Dnes";

      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      if (isSameDay(cardDate, yesterday)) return "Včera";

      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      if (isSameDay(cardDate, tomorrow)) return "Zítra";

      return cardDate.toLocaleDateString("cs-CZ", {
        weekday: "long",
        day: "numeric",
        month: "numeric"
      }).replace(/^\w/, (c) => c.toUpperCase());
    }

    return card.topic || "Plán";
  };

  const openHistoryCarousel = () => {
    const routineCards = [...savedCards].sort((a, b) => {
      const dateA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : Date.now();
      const dateB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : Date.now();
      return dateA - dateB;
    });

    const todayIndex = routineCards.findIndex(card => {
      const lbl = getCardDayLabel(card);
      return lbl === "Dnes";
    });

    if (todayIndex !== -1) {
      setCarouselIndex(todayIndex);
    } else if (routineCards.length > 0) {
      setCarouselIndex(routineCards.length - 1);
    } else {
      setCarouselIndex(0);
    }
    setShowHistory(true);
  };

  const sendAppStateSync = (wsOverride?: WebSocket) => {
    const ws = wsOverride || wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const uniqueSubjects = Array.from(new Set(savedCards.map(c => c.subject || "Denní plán")));
    const existingCardsInfo = savedCards
      .map(c => ({
        topic: c.topic,
        targetDateStr: (c as any).targetDateStr || "",
        content: c.content,
        subject: c.subject || "Denní plán"
      }));

    const notesList = getNotesForCurrentChat();
    const activeNoteObj = notesList.find(n => n.id === (activeNoteId || "default")) || notesList[0];
    const activeNoteTitle = activeNoteObj ? activeNoteObj.title : "Hlavní poznámka";

    const activeChatForSync = chatsRef.current.find(c => c.id === activeChatIdRef.current);
    const foldersListForSync = activeChatForSync?.folders || [];

    const payload = {
      activeChatId: activeChatIdRef.current,
      activeNoteId: activeNoteIdRef.current || "default",
      subjects: uniqueSubjects,
      currentSubject: "Denní plán",
      totalCards: savedCards.length,
      currentDateStr: formatDateKey(new Date()),
      selectedDateStr: formatDateKey(selectedDate),
      existingCards: existingCardsInfo,
      activePanelType: activePanelType,
      modernSpaceContent: localModernContent,
      activeNoteTitle: activeNoteTitle,
      allNotes: notesList.map(n => ({ id: n.id, title: n.title, content: n.content, folderId: (n as any).folderId || null })),
      folders: foldersListForSync.map(f => ({ id: f.id, title: f.title, parentId: f.parentId || null, isCollapsed: !!f.isCollapsed })),
      allChats: chatsRef.current.map(c => ({ id: c.id, title: c.title })),
      profileMemo: userProfileMemoRef.current,
      isNotesFocused: isNotesFocused
    };

    try {
      ws.send(JSON.stringify({
        type: "sync_app_state",
        payload: payload
      }));
    } catch (e) {
      console.error("Error sending app state sync:", e);
    }
  };

  const handleTouchStart = (e: TouchEvent) => {
    setTouchStart({
      x: e.touches[0].clientX,
      y: e.touches[0].clientY
    });
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (!touchStart) return;
    const diffX = touchStart.x - e.changedTouches[0].clientX;
    const diffY = touchStart.y - e.changedTouches[0].clientY;
    const minDistance = 50; // trigger distance in pixels

    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > minDistance) {
      if (diffX > 0) {
        // Swipe left -> Next panel
        if (activePanelType === 'general') {
          setActivePanelType('morning');
        } else if (activePanelType === 'morning') {
          setActivePanelType('evening');
        }
      } else {
        // Swipe right -> Previous panel
        if (activePanelType === 'evening') {
          setActivePanelType('morning');
        } else if (activePanelType === 'morning') {
          setActivePanelType('general');
        }
      }
    }
    setTouchStart(null);
  };

  const handleMouseDown = (e: MouseEvent) => {
    setDragStartX(e.clientX);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (dragStartX === null) return;
    const diffX = dragStartX - e.clientX;
    const minDistance = 75; // trigger distance in pixels

    if (Math.abs(diffX) > minDistance) {
      if (diffX > 0) {
        // Swipe left -> Next panel
        if (activePanelType === 'general') {
          setActivePanelType('morning');
        } else if (activePanelType === 'morning') {
          setActivePanelType('evening');
        }
      } else {
        // Swipe right -> Previous panel
        if (activePanelType === 'evening') {
          setActivePanelType('morning');
        } else if (activePanelType === 'morning') {
          setActivePanelType('general');
        }
      }
      setDragStartX(null); // Reset after action
    }
  };

  const handleMouseUp = () => {
    setDragStartX(null);
  };

  useEffect(() => {
    if (isConnected && wsRef.current) {
      sendAppStateSync();
    }
  }, [savedCards, isConnected, selectedDate, localModernContent, activeChatId, activeNoteId, isNotesFocused]);

  const formatDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const getCardForDateAndType = (date: Date, type: 'general' | 'morning' | 'evening') => {
    const key = formatDateKey(date);
    const subjectMap = {
      general: "Denní plán",
      morning: "Ranní rutina",
      evening: "Večerní rutina"
    };

    if (type === 'morning') {
      return savedCards.find(c => c.subject === "Ranní rutina" || (c as any).targetDateStr === "routine_morning") || null;
    }
    if (type === 'evening') {
      return savedCards.find(c => c.subject === "Večerní rutina" || (c as any).targetDateStr === "routine_evening") || null;
    }

    // Try to find a card explicitly matching targetDateStr AND subject of that type
    const match = savedCards.find(c => 
      (c as any).targetDateStr === key && 
      (c.subject === subjectMap[type] || (!c.subject && type === 'general'))
    );
    
    return match || null;
  };

  const getCardContentAndId = (date: Date, type: 'general' | 'morning' | 'evening') => {
    const card = getCardForDateAndType(date, type);
    if (card) {
      return { id: card.id, content: card.content, topic: card.topic, isDefault: false };
    } else {
      if (type === 'morning') {
        return { id: `virtual-morning`, content: DEFAULT_MORNING_ROUTINE, topic: "Ranní rutina", isDefault: true };
      } else if (type === 'evening') {
        return { id: `virtual-evening`, content: DEFAULT_EVENING_ROUTINE, topic: "Večerní rutina", isDefault: true };
      } else {
        return { id: null, content: "", topic: "Dodatečné úkoly", isDefault: true };
      }
    }
  };

  const getPanelTitle = (type: 'general' | 'morning' | 'evening') => {
    switch(type) {
      case 'morning': return "Ranní rutina ☀️";
      case 'evening': return "Večerní rutina 🌙";
      default: return "Denní plán 📋";
    }
  };

  const parseChecklistLines = (content: string) => {
    if (!content) return [];
    return content.split("\n").map((line, idx) => {
      const clean = line.trim();
      const isBullet = clean.startsWith("- ") || clean.startsWith("* ");
      if (isBullet) {
        const match = line.match(/^(\s*[-*]\s*)(.*)$/);
        if (match) {
          const prefix = match[1];
          const suffix = match[2].trim();
          let checked = false;
          let text = suffix;
          if (suffix.startsWith("[x]") || suffix.startsWith("[X]")) {
            checked = true;
            text = suffix.substring(3).trim();
          } else if (suffix.startsWith("[ ]")) {
            checked = false;
            text = suffix.substring(3).trim();
          }
          return {
            type: "task",
            idx,
            checked,
            text,
            rawLine: line
          };
        }
      }
      return {
        type: "text",
        idx,
        text: line,
        rawLine: line
      };
    });
  };

  const getCardForDate = (date: Date) => {
    return getCardForDateAndType(date, 'general');
  };

  // Track selected date card matching
  useEffect(() => {
    const match = getCardForDateAndType(selectedDate, activePanelType);
    if (match) {
      setActiveCardId(match.id);
    } else {
      setActiveCardId(null);
    }
  }, [selectedDate, savedCards, activePanelType]);

  const handleNewCardGenerated = (
    topic: string,
    content: string,
    subject?: string,
    osnova?: string,
    lessonPlan?: string[] | null,
    lessonIndex?: number | null,
    targetDateStr?: string | null
  ) => {
    saveCardToDb(topic, content, subject || "Denní plán", osnova, lessonPlan, lessonIndex, targetDateStr);
  };

  const saveCardToDb = async (
    topic: string,
    content: string,
    subjectName?: string,
    osnova?: string,
    lessonPlan?: string[] | null,
    lessonIndex?: number | null,
    targetDateStr?: string | null
  ) => {
    if (!userId || !topic) return;
    
    const targetSubject = subjectName || "Denní plán";
    const isRoutine = targetSubject === "Ranní rutina" || targetSubject === "Večerní rutina";
    const resolvedDateStr = isRoutine 
      ? (targetSubject === "Ranní rutina" ? "routine_morning" : "routine_evening")
      : (targetDateStr || formatDateKey(selectedDate));

    // Find card that belongs to this specific date AND has the same subject,
    // OR matches exactly by topic name (for general non-date topic cards).
    const existingCard = savedCards.find(
      card => {
        const cardDate = (card as any).targetDateStr;
        const cardSubject = card.subject || "Denní plán";
        if (isRoutine) {
          return cardSubject === targetSubject || cardDate === resolvedDateStr;
        }
        if (cardDate && cardDate === resolvedDateStr) {
          return cardSubject === targetSubject;
        }
        if (!cardDate && !isRoutine) {
          return card.topic.toLowerCase().trim() === topic.toLowerCase().trim();
        }
        return false;
      }
    );

    if (existingCard) {
      try {
        await updateDoc(doc(db, "study-cards", existingCard.id), {
          content: content,
          topic: topic,
          createdAt: serverTimestamp()
        });
        setActiveCardId(existingCard.id);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `study-cards/${existingCard.id}`);
      }
      return;
    }

    try {
      const docRef = await addDoc(collection(db, "study-cards"), {
        topic: topic,
        content: content,
        subject: targetSubject,
        osnova: osnova || "",
        lessonPlan: lessonPlan || null,
        lessonIndex: lessonIndex || null,
        createdAt: serverTimestamp(),
        targetDateStr: resolvedDateStr,
        userId: userId
      });
      setActiveCardId(docRef.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "study-cards");
    }
  };

  const deleteCardFromDb = async (cardId: string) => {
    try {
      if (activeCardId === cardId) {
        setActiveCardId(null);
      }
      await deleteDoc(doc(db, "study-cards", cardId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `study-cards/${cardId}`);
    }
  };

  const handleToggleTask = async (type: 'general' | 'morning' | 'evening', date: Date, lineIndex: number) => {
    const cardInfo = getCardContentAndId(date, type);
    const content = cardInfo.content;
    if (!content) return;

    const lines = content.split("\n");
    if (lineIndex < 0 || lineIndex >= lines.length) return;

    const targetLine = lines[lineIndex];
    const isBullet = targetLine.trim().startsWith("- ") || targetLine.trim().startsWith("* ");
    if (!isBullet) return;

    const match = targetLine.match(/^(\s*[-*]\s*)(.*)$/);
    if (!match) return;

    const prefix = match[1];
    const suffix = match[2].trim();

    let newSuffix = "";
    let isNowCompleted = false;

    if (suffix.startsWith("[x]") || suffix.startsWith("[X]")) {
      newSuffix = suffix.substring(3).trim();
      isNowCompleted = false;
    } else if (suffix.startsWith("[ ]")) {
      newSuffix = "[x] " + suffix.substring(3).trim();
      isNowCompleted = true;
    } else {
      newSuffix = "[x] " + suffix;
      isNowCompleted = true;
    }

    lines[lineIndex] = `${prefix.trimEnd()} ${newSuffix}`;

    if (isNowCompleted) {
      const movedLine = lines.splice(lineIndex, 1)[0];
      let lastBulletIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i].trim();
        if (ln.startsWith("- ") || ln.startsWith("* ")) {
          lastBulletIndex = i;
        }
      }
      if (lastBulletIndex !== -1) {
        lines.splice(lastBulletIndex + 1, 0, movedLine);
      } else {
        lines.push(movedLine);
      }
    } else {
      const movedLine = lines.splice(lineIndex, 1)[0];
      let firstCompletedIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i].trim();
        if ((ln.startsWith("- ") || ln.startsWith("* ")) && (ln.includes("[x]") || ln.includes("[X]"))) {
          firstCompletedIndex = i;
          break;
        }
      }
      if (firstCompletedIndex !== -1) {
        lines.splice(firstCompletedIndex, 0, movedLine);
      } else {
        let lastUnfinishedIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i].trim();
          if ((ln.startsWith("- ") || ln.startsWith("* ")) && !ln.includes("[x]") && !ln.includes("[X]")) {
            lastUnfinishedIndex = i;
          }
        }
        if (lastUnfinishedIndex !== -1) {
          lines.splice(lastUnfinishedIndex + 1, 0, movedLine);
        } else {
          lines.push(movedLine);
        }
      }
    }

    const updatedContent = lines.join("\n");

    if (!cardInfo.isDefault && cardInfo.id && !cardInfo.id.startsWith("virtual-")) {
      try {
        await updateDoc(doc(db, "study-cards", cardInfo.id), {
          content: updatedContent,
          createdAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `study-cards/${cardInfo.id}`);
      }
    } else {
      const subjectName = type === 'morning' ? "Ranní rutina" : type === 'evening' ? "Večerní rutina" : "Denní plán";
      const topicName = type === 'morning' ? "Ranní rutina" : type === 'evening' ? "Večerní rutina" : "Dodatečné úkoly";
      const resolvedDateStr = type === 'morning' 
        ? "routine_morning" 
        : type === 'evening' 
          ? "routine_evening" 
          : formatDateKey(date);

      try {
        await addDoc(collection(db, "study-cards"), {
          topic: topicName,
          content: updatedContent,
          subject: subjectName,
          osnova: "Rutina",
          lessonPlan: null,
          lessonIndex: null,
          createdAt: serverTimestamp(),
          targetDateStr: resolvedDateStr,
          userId: userId
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, "study-cards");
      }
    }
  };

  const handleSendImage = async (base64Image: string) => {
    setStatus("Odesílám fotku...");
    
    // Check if we are connected to the live session
    if (isConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Send image to Live WebSocket
      const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
      
      wsRef.current.send(JSON.stringify({ video: cleanBase64 }));
      
      const guideText = "Právě jsem pořídil a poslal ti tuto fotku. Podívej se na ni a krátce mi řekni, co na ní vidíš, abychom se o ní mohli bavit.";
      setUserTranscript("Posílám fotku...");
      setAssistantTranscript("");
      wsRef.current.send(JSON.stringify({ text: guideText }));
      
      const userMsgObj = {
        id: Math.random().toString(36).substring(7),
        userText: `📷 [Poslaná fotka]`,
        timestamp: new Date().toISOString()
      };

      if (activeChatId) {
        const activeChat = chats.find(c => c.id === activeChatId);
        const updatedMessages = [...(activeChat?.messages || []), userMsgObj];
        try {
          await updateDoc(doc(db, "chats", activeChatId), {
            messages: updatedMessages
          });
        } catch (err) {
          console.error("Failed to append image placeholder in live session:", err);
        }
      }

      setStatus("Fotka odeslána do hlasové relace");
      return;
    }

    // Otherwise, we are in standard Text Chat mode.
    setIsSubmittingText(true);
    try {
      stopAudioPlayback();
      const existingCardsInfo = savedCards
        .filter(c => c.subject === "Denní plán" || !c.subject)
        .map(c => ({
          topic: c.topic,
          targetDateStr: (c as any).targetDateStr || "",
          content: c.content
        }));

      // Map chat history so it conforms to history format
      const formattedHistory = chatHistory.slice(-8).map(h => ({
        userText: h.userText || "",
        assistantText: h.assistantText || ""
      }));

      const notesList = getNotesForCurrentChat();
      const activeNoteObj = notesList.find(n => n.id === (activeNoteId || "default")) || notesList[0];
      const activeNoteTitle = activeNoteObj ? activeNoteObj.title : "Hlavní poznámka";

      const response = await fetch("/api/chat-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Tady je fotka, kterou jsem právě vyfotil. Podívej se na ni, popiš ji prosím a řekni mi, že se tě na ni můžu vyptávat.",
          image: base64Image,
          mimeType: "image/jpeg",
          userId,
          selectedDateStr: formatDateKey(selectedDate),
          currentDateStr: formatDateKey(new Date()),
          existingCards: existingCardsInfo,
          history: formattedHistory,
          modernSpaceContent: localModernContent,
          profileMemo: userProfileMemo,
          activeNoteTitle: activeNoteTitle,
          allNotes: notesList.map(n => ({ id: n.id, title: n.title, content: n.content, folderId: (n as any).folderId || null })),
          folders: (chats.find(c => c.id === activeChatId)?.folders || []).map(f => ({ id: f.id, title: f.title, parentId: f.parentId || null, isCollapsed: !!f.isCollapsed })),
          allChats: chats.map(c => ({ id: c.id, title: c.title }))
        }),
      });

      if (!response.ok) {
        throw new Error("Nepodařilo se poslat fotku Shate k analýze.");
      }

      const data = await response.json();
      if (data.profileMemo !== undefined && data.profileMemo !== null && data.profileMemo !== userProfileMemo) {
        setUserProfileMemo(data.profileMemo);
        saveUserProfileMemo(data.profileMemo);
      }
      setUserTranscript("Posílám fotku...");
      setAssistantTranscript(data.reply);
      
      const userMsgObj = {
        id: Math.random().toString(36).substring(7),
        userText: "📷 [Obrázek]",
        timestamp: new Date().toISOString()
      };
      
      const assistantMsgObj = {
        id: Math.random().toString(36).substring(7),
        assistantText: data.reply,
        timestamp: new Date().toISOString()
      };

      if (activeChatId) {
        const activeChat = chats.find(c => c.id === activeChatId);
        const updatedMessages = [...(activeChat?.messages || []), userMsgObj, assistantMsgObj];
        const updateFields: any = {
          messages: updatedMessages
        };

        let tempActiveNoteId = activeNoteId || "default";

        if (data.action) {
          if (data.action.type === "create_new_note") {
            const currentNotes = getNotesForCurrentChat();
            const noteTitle = data.action.title || `Poznámka ${currentNotes.length + 1}`;
            const newId = `note_${Date.now()}`;
            const newNote = {
              id: newId,
              title: noteTitle,
              content: ""
            };
            const updatedNotes = [...currentNotes, newNote];
            updateFields.notes = updatedNotes;
            updateFields.activeNoteId = newId;
            updateFields.modernSpaceContent = "";
            tempActiveNoteId = newId;
            setActiveNoteId(newId);
            setLocalModernContent("");
          } else if (data.action.type === "select_note" && data.action.title) {
            const currentNotes = getNotesForCurrentChat();
            const searchTitle = data.action.title.toLowerCase().trim();
            const foundNote = currentNotes.find(n => n.title.toLowerCase().includes(searchTitle));
            if (foundNote) {
              updateFields.activeNoteId = foundNote.id;
              updateFields.modernSpaceContent = foundNote.content || "";
              tempActiveNoteId = foundNote.id;
              setActiveNoteId(foundNote.id);
              setLocalModernContent(foundNote.content || "");
            }
          } else if (data.action.type === "select_chat" && data.action.title) {
            const searchTitle = data.action.title.toLowerCase().trim();
            const foundChat = chats.find(c => c.title.toLowerCase().includes(searchTitle));
            if (foundChat) {
              setTimeout(() => {
                setActiveChatId(foundChat.id);
                setStatus(`Přepnuto na chat: ${foundChat.title}`);
              }, 300);
            }
          } else if ((data.action.type === "rename_chat" || data.action.type === "rename_note") && data.action.title) {
            const newTitle = data.action.title.trim();
            updateFields.title = newTitle;
            const currentNotes = updateFields.notes || getNotesForCurrentChat();
            const updatedNotes = currentNotes.map((n: any) => {
              if (n.id === tempActiveNoteId) {
                return { ...n, title: newTitle };
              }
              return n;
            });
            updateFields.notes = updatedNotes;
          } else if (data.action.type === "create_folder" && data.action.title) {
            const currentFolders = activeChat?.folders || [];
            let parentId = null;
            if (data.action.parentFolderTitle) {
              const searchParent = data.action.parentFolderTitle.toLowerCase().trim();
              const foundParent = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchParent));
              if (foundParent) parentId = foundParent.id;
            }
            const newFolder = {
              id: `folder_${Date.now()}`,
              title: data.action.title.trim(),
              parentId: parentId,
              isCollapsed: false
            };
            updateFields.folders = [...currentFolders, newFolder];
          } else if (data.action.type === "toggle_folder" && data.action.title) {
            const currentFolders = activeChat?.folders || [];
            const searchTitle = data.action.title.toLowerCase().trim();
            updateFields.folders = currentFolders.map((f: any) => {
              if (f.title.toLowerCase().includes(searchTitle)) {
                return { ...f, isCollapsed: data.action.isCollapsed !== false };
              }
              return f;
            });
          } else if (data.action.type === "move_note" && data.action.noteTitle) {
            const currentNotes = updateFields.notes || getNotesForCurrentChat();
            const currentFolders = activeChat?.folders || [];
            const searchNote = data.action.noteTitle.toLowerCase().trim();
            const targetNote = currentNotes.find((n: any) => n.title.toLowerCase().includes(searchNote));
            if (targetNote) {
              let targetFolderId = null;
              if (data.action.folderTitle) {
                const searchFolder = data.action.folderTitle.toLowerCase().trim();
                const targetFolder = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchFolder));
                if (targetFolder) targetFolderId = targetFolder.id;
              }
              updateFields.notes = currentNotes.map((n: any) => {
                if (n.id === targetNote.id) {
                  return { ...n, folderId: targetFolderId };
                }
                return n;
              });
            }
          } else if (data.action.type === "rename_folder" && data.action.oldTitle && data.action.newTitle) {
            const currentFolders = activeChat?.folders || [];
            const searchTitle = data.action.oldTitle.toLowerCase().trim();
            updateFields.folders = currentFolders.map((f: any) => {
              if (f.title.toLowerCase().includes(searchTitle)) {
                return { ...f, title: data.action.newTitle.trim() };
              }
              return f;
            });
          } else if (data.action.type === "delete_folder" && data.action.title) {
            const currentFolders = activeChat?.folders || [];
            const searchTitle = data.action.title.toLowerCase().trim();
            const folderToDelete = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchTitle));
            if (folderToDelete) {
              const folderId = folderToDelete.id;
              const filteredFolders = currentFolders.filter((f: any) => f.id !== folderId);
              const newParentId = folderToDelete.parentId || null;
              const updatedFoldersFinal = filteredFolders.map((f: any) => {
                if (f.parentId === folderId) {
                  return { ...f, parentId: newParentId };
                }
                return f;
              });
              updateFields.folders = updatedFoldersFinal;
              const currentNotes = updateFields.notes || getNotesForCurrentChat();
              updateFields.notes = currentNotes.map((n: any) => {
                if (n.folderId === folderId) {
                  return { ...n, folderId: newParentId };
                }
                return n;
              });
            }
          } else if (data.action.type === "move_folder" && data.action.folderTitle) {
            const currentFolders = activeChat?.folders || [];
            const searchFolder = data.action.folderTitle.toLowerCase().trim();
            const targetFolder = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchFolder));
            if (targetFolder) {
              let parentId = null;
              if (data.action.parentFolderTitle) {
                const searchParent = data.action.parentFolderTitle.toLowerCase().trim();
                const parentFolder = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchParent));
                if (parentFolder && parentFolder.id !== targetFolder.id) {
                  parentId = parentFolder.id;
                }
              }
              updateFields.folders = currentFolders.map((f: any) => {
                if (f.id === targetFolder.id) {
                  return { ...f, parentId: parentId };
                }
                return f;
              });
            }
          }
        }

        if (data.modernSpaceContent !== undefined && data.modernSpaceContent !== null) {
          updateFields.modernSpaceContent = data.modernSpaceContent;
          const currentNotes = updateFields.notes || getNotesForCurrentChat();
          const updatedNotes = currentNotes.map((n: any) => {
            if (n.id === tempActiveNoteId) {
              return { ...n, content: data.modernSpaceContent };
            }
            return n;
          });
          updateFields.notes = updatedNotes;
        }
        await updateDoc(doc(db, "chats", activeChatId), updateFields);
      }

      setStatus("Zapsáno");

      if (data.card) {
        setCustomCard({
          topic: data.card.topic,
          content: data.card.content,
          subject: data.card.subject || "Studijní plán"
        });
        setResearchStatus("idle");

        await saveStudyPlanToDb(
          data.card.topic,
          data.card.content,
          data.card.osnova
        );
      }
    } catch (err: any) {
      console.error("Photo chat failed:", err);
      setStatus("Chyba odeslání fotky");
    } finally {
      setIsSubmittingText(false);
    }
  };

  const handleSendTextMessage = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if ((!textMessage.trim() && !attachedFile) || isSubmittingText) return;

    const userMsg = textMessage.trim() || `Prostuduj prosím přiložený soubor ${attachedFile ? `"${attachedFile.name}"` : ""}`;
    const fileToSend = attachedFile;
    
    setTextMessage("");
    setAttachedFile(null);

    if (isConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setUserTranscript(userMsg);
      setAssistantTranscript("");
      wsRef.current.send(JSON.stringify({ text: userMsg }));
      return;
    }

    setIsSubmittingText(true);
    setStatus("Odesílám zprávu...");

    try {
      stopAudioPlayback();

      const existingCardsInfo = savedCards
        .filter(c => c.subject === "Denní plán" || !c.subject)
        .map(c => ({
          topic: c.topic,
          targetDateStr: (c as any).targetDateStr || "",
          content: c.content
        }));

      const formattedHistory = chatHistory.slice(-8).map(h => ({
        userText: h.userText || "",
        assistantText: h.assistantText || ""
      }));

      const notesList = getNotesForCurrentChat();
      const activeNoteObj = notesList.find(n => n.id === (activeNoteId || "default")) || notesList[0];
      const activeNoteTitle = activeNoteObj ? activeNoteObj.title : "Hlavní poznámka";

      const response = await fetch("/api/chat-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          message: userMsg, 
          userId,
          selectedDateStr: formatDateKey(selectedDate),
          currentDateStr: formatDateKey(new Date()),
          existingCards: existingCardsInfo,
          history: formattedHistory,
          attachedFile: fileToSend,
          modernSpaceContent: localModernContent,
          profileMemo: userProfileMemo,
          activeNoteTitle: activeNoteTitle,
          allNotes: notesList.map(n => ({ id: n.id, title: n.title, content: n.content, folderId: (n as any).folderId || null })),
          folders: (chats.find(c => c.id === activeChatId)?.folders || []).map(f => ({ id: f.id, title: f.title, parentId: f.parentId || null, isCollapsed: !!f.isCollapsed })),
          allChats: chats.map(c => ({ id: c.id, title: c.title }))
        }),
      });

      if (!response.ok) {
        throw new Error("Nepodařilo se odeslat zprávu.");
      }

      const data = await response.json();
      if (data.profileMemo !== undefined && data.profileMemo !== null && data.profileMemo !== userProfileMemo) {
        setUserProfileMemo(data.profileMemo);
        saveUserProfileMemo(data.profileMemo);
      }
      
      setUserTranscript(userMsg);
      setAssistantTranscript(data.reply);
      
      const userMsgObj = {
        id: Math.random().toString(36).substring(7),
        userText: fileToSend 
          ? `📁 [Příloha: ${fileToSend.name}]\n${userMsg}`
          : userMsg,
        timestamp: new Date().toISOString()
      };

      const assistantMsgObj = {
        id: Math.random().toString(36).substring(7),
        assistantText: data.reply,
        timestamp: new Date().toISOString()
      };

      if (activeChatId) {
        const activeChat = chats.find(c => c.id === activeChatId);
        const updatedMessages = [...(activeChat?.messages || []), userMsgObj, assistantMsgObj];
        
        let updatedTitle = activeChat?.title;
        if (activeChat?.title === "Nová konverzace" || activeChat?.title === "Moje první učení 🧠") {
          const words = userMsg.split(" ");
          updatedTitle = words.slice(0, 4).join(" ") + (words.length > 4 ? "..." : "");
        }

        const updateFields: any = {
          messages: updatedMessages,
          title: updatedTitle
        };

        let tempActiveNoteId = activeNoteId || "default";

        if (data.action) {
          if (data.action.type === "create_new_note") {
            const currentNotes = getNotesForCurrentChat();
            const noteTitle = data.action.title || `Poznámka ${currentNotes.length + 1}`;
            const newId = `note_${Date.now()}`;
            const newNote = {
              id: newId,
              title: noteTitle,
              content: ""
            };
            const updatedNotes = [...currentNotes, newNote];
            updateFields.notes = updatedNotes;
            updateFields.activeNoteId = newId;
            updateFields.modernSpaceContent = "";
            tempActiveNoteId = newId;
            setActiveNoteId(newId);
            setLocalModernContent("");
          } else if (data.action.type === "select_note" && data.action.title) {
            const currentNotes = getNotesForCurrentChat();
            const searchTitle = data.action.title.toLowerCase().trim();
            const foundNote = currentNotes.find(n => n.title.toLowerCase().includes(searchTitle));
            if (foundNote) {
              updateFields.activeNoteId = foundNote.id;
              updateFields.modernSpaceContent = foundNote.content || "";
              tempActiveNoteId = foundNote.id;
              setActiveNoteId(foundNote.id);
              setLocalModernContent(foundNote.content || "");
            }
          } else if (data.action.type === "select_chat" && data.action.title) {
            const searchTitle = data.action.title.toLowerCase().trim();
            const foundChat = chats.find(c => c.title.toLowerCase().includes(searchTitle));
            if (foundChat) {
              setTimeout(() => {
                setActiveChatId(foundChat.id);
                setStatus(`Přepnuto na chat: ${foundChat.title}`);
              }, 300);
            }
          } else if ((data.action.type === "rename_chat" || data.action.type === "rename_note") && data.action.title) {
            const newTitle = data.action.title.trim();
            updateFields.title = newTitle;
            const currentNotes = updateFields.notes || getNotesForCurrentChat();
            const updatedNotes = currentNotes.map((n: any) => {
              if (n.id === tempActiveNoteId) {
                return { ...n, title: newTitle };
              }
              return n;
            });
            updateFields.notes = updatedNotes;
          } else if (data.action.type === "create_folder" && data.action.title) {
            const currentFolders = activeChat?.folders || [];
            let parentId = null;
            if (data.action.parentFolderTitle) {
              const searchParent = data.action.parentFolderTitle.toLowerCase().trim();
              const foundParent = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchParent));
              if (foundParent) parentId = foundParent.id;
            }
            const newFolder = {
              id: `folder_${Date.now()}`,
              title: data.action.title.trim(),
              parentId: parentId,
              isCollapsed: false
            };
            updateFields.folders = [...currentFolders, newFolder];
          } else if (data.action.type === "toggle_folder" && data.action.title) {
            const currentFolders = activeChat?.folders || [];
            const searchTitle = data.action.title.toLowerCase().trim();
            updateFields.folders = currentFolders.map((f: any) => {
              if (f.title.toLowerCase().includes(searchTitle)) {
                return { ...f, isCollapsed: data.action.isCollapsed !== false };
              }
              return f;
            });
          } else if (data.action.type === "move_note" && data.action.noteTitle) {
            const currentNotes = updateFields.notes || getNotesForCurrentChat();
            const currentFolders = activeChat?.folders || [];
            const searchNote = data.action.noteTitle.toLowerCase().trim();
            const targetNote = currentNotes.find((n: any) => n.title.toLowerCase().includes(searchNote));
            if (targetNote) {
              let targetFolderId = null;
              if (data.action.folderTitle) {
                const searchFolder = data.action.folderTitle.toLowerCase().trim();
                const targetFolder = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchFolder));
                if (targetFolder) targetFolderId = targetFolder.id;
              }
              updateFields.notes = currentNotes.map((n: any) => {
                if (n.id === targetNote.id) {
                  return { ...n, folderId: targetFolderId };
                }
                return n;
              });
            }
          } else if (data.action.type === "rename_folder" && data.action.oldTitle && data.action.newTitle) {
            const currentFolders = activeChat?.folders || [];
            const searchTitle = data.action.oldTitle.toLowerCase().trim();
            updateFields.folders = currentFolders.map((f: any) => {
              if (f.title.toLowerCase().includes(searchTitle)) {
                return { ...f, title: data.action.newTitle.trim() };
              }
              return f;
            });
          } else if (data.action.type === "delete_folder" && data.action.title) {
            const currentFolders = activeChat?.folders || [];
            const searchTitle = data.action.title.toLowerCase().trim();
            const folderToDelete = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchTitle));
            if (folderToDelete) {
              const folderId = folderToDelete.id;
              const filteredFolders = currentFolders.filter((f: any) => f.id !== folderId);
              const newParentId = folderToDelete.parentId || null;
              const updatedFoldersFinal = filteredFolders.map((f: any) => {
                if (f.parentId === folderId) {
                  return { ...f, parentId: newParentId };
                }
                return f;
              });
              updateFields.folders = updatedFoldersFinal;
              const currentNotes = updateFields.notes || getNotesForCurrentChat();
              updateFields.notes = currentNotes.map((n: any) => {
                if (n.folderId === folderId) {
                  return { ...n, folderId: newParentId };
                }
                return n;
              });
            }
          } else if (data.action.type === "move_folder" && data.action.folderTitle) {
            const currentFolders = activeChat?.folders || [];
            const searchFolder = data.action.folderTitle.toLowerCase().trim();
            const targetFolder = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchFolder));
            if (targetFolder) {
              let parentId = null;
              if (data.action.parentFolderTitle) {
                const searchParent = data.action.parentFolderTitle.toLowerCase().trim();
                const parentFolder = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchParent));
                if (parentFolder && parentFolder.id !== targetFolder.id) {
                  parentId = parentFolder.id;
                }
              }
              updateFields.folders = currentFolders.map((f: any) => {
                if (f.id === targetFolder.id) {
                  return { ...f, parentId: parentId };
                }
                return f;
              });
            }
          }
        }

        if (data.modernSpaceContent !== undefined && data.modernSpaceContent !== null) {
          updateFields.modernSpaceContent = data.modernSpaceContent;
          const currentNotes = updateFields.notes || getNotesForCurrentChat();
          const updatedNotes = currentNotes.map((n: any) => {
            if (n.id === tempActiveNoteId) {
              return { ...n, content: data.modernSpaceContent };
            }
            return n;
          });
          updateFields.notes = updatedNotes;
        }

        await updateDoc(doc(db, "chats", activeChatId), updateFields);
      }

      setStatus("Zapsáno");

      if (data.card) {
        setCustomCard({
          topic: data.card.topic,
          content: data.card.content,
          subject: data.card.subject || "Studijní plán"
        });
        setResearchStatus("idle");

        await saveStudyPlanToDb(
          data.card.topic,
          data.card.content,
          data.card.osnova
        );
      }
    } catch (error) {
      console.error("Text message error:", error);
      setStatus("Chyba odeslání");
    } finally {
      setIsSubmittingText(false);
    }
  };

  const saveSpeechMessageToDb = async (ut: string, at: string) => {
    if (!ut.trim() && !at.trim()) return;
    const currentActiveChatId = activeChatIdRef.current;
    if (currentActiveChatId) {
      try {
        const chatDocRef = doc(db, "chats", currentActiveChatId);
        const chatSnap = await getDoc(chatDocRef);
        
        let existingMessages = [];
        let currentTitle = "Nová konverzace";
        if (chatSnap.exists()) {
          const chatData = chatSnap.data();
          existingMessages = chatData.messages || [];
          currentTitle = chatData.title || "Nová konverzace";
        } else {
          // Fallback to chatsRef
          const activeChat = chatsRef.current.find(c => c.id === currentActiveChatId);
          existingMessages = activeChat?.messages || [];
          currentTitle = activeChat?.title || "Nová konverzace";
        }
        
        const userMsgObj = {
          id: Math.random().toString(36).substring(7),
          userText: ut.trim() ? ut.trim() : "🎙️ (Hlasová zpráva)",
          timestamp: new Date().toISOString()
        };

        const assistantMsgObj = {
          id: Math.random().toString(36).substring(7),
          assistantText: at.trim() ? at.trim() : "🎙️ (Hlasová odpověď)",
          timestamp: new Date().toISOString()
        };

        const updatedMessages = [...existingMessages, userMsgObj, assistantMsgObj];
        
        let updatedTitle = currentTitle;
        if (currentTitle === "Nová konverzace" || currentTitle === "Moje první učení 🧠" || currentTitle === "Nový chat") {
          const textToUse = ut.trim() || at.trim();
          const words = textToUse.split(" ");
          updatedTitle = words.slice(0, 4).join(" ") + (words.length > 4 ? "..." : "");
        }

        await updateDoc(chatDocRef, {
          messages: updatedMessages,
          title: updatedTitle
        });
      } catch (err) {
        console.error("Failed to save speech message to db:", err);
      }
    }
  };

  const startSession = async () => {
    try {
      setStatus("Připojování...");
      isNewTurnRef.current = true;
      setUserTranscript("");
      setAssistantTranscript("");
      setResearchStatus("idle");
      setResearchTopic("");
      setResearchResult("");
      setResearchSources([]);
      setCustomCard(null);
      
      audioCtxRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws-live`);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("Připojování k Shate...");
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        if (msg.type === "session_ready") {
          setIsConnected(true);
          setStatus("Hlas aktivní");
          startAudioProcessing();
          sendAppStateSync(ws);
          return;
        }

        if (msg.type === "voice_speed_changed") {
          const newSpeed = Number(msg.speed) || 1.4;
          setVoiceSpeed(newSpeed);
          setStatus(`Rychlost: ${newSpeed}x`);
          return;
        }

        if (msg.type === "update_modern_space") {
          // Trigger the beautiful pulsing edit animation for 3 seconds!
          setIsSubmittingText(true);
          const editTimer = setTimeout(() => {
            setIsSubmittingText(false);
          }, 3000);

          const currentChatId = activeChatIdRef.current;
          if (currentChatId && msg.content !== undefined) {
            const currentNotes = getNotesForChatRef(currentChatId);
            const currActiveId = activeNoteIdRef.current || "default";
            const updatedNotes = currentNotes.map(n => {
              if (n.id === currActiveId) {
                return { ...n, content: msg.content };
              }
              return n;
            });
            const isDefault = currActiveId === "default" || currActiveId === currentNotes[0]?.id;
            
            const updateFields: any = {
              notes: updatedNotes,
              activeNoteId: currActiveId
            };
            if (isDefault) {
              updateFields.modernSpaceContent = msg.content;
            }

            updateDoc(doc(db, "chats", currentChatId), updateFields).then(() => {
              setStatus("Prostor aktualizován");
            }).catch(err => {
              console.error("Error setting modern space content from WS:", err);
            });
          }
          return;
        }

        if (msg.type === "create_new_note") {
          const currentChatId = activeChatIdRef.current;
          if (currentChatId) {
            const currentNotes = getNotesForChatRef(currentChatId);
            const title = msg.title || `Poznámka ${currentNotes.length + 1}`;
            const newId = `note_${Date.now()}`;
            const newNote = {
              id: newId,
              title: title,
              content: ""
            };
            const updatedNotes = [...currentNotes, newNote];
            
            updateDoc(doc(db, "chats", currentChatId), {
              notes: updatedNotes,
              activeNoteId: newId,
              modernSpaceContent: ""
            }).then(() => {
              setActiveNoteId(newId);
              setLocalModernContent("");
              setStatus(`Vytvořena ${title}`);
            }).catch(err => {
              console.error("Error creating note from WS:", err);
            });
          }
          return;
        }

        if (msg.type === "select_note") {
          const currentChatId = activeChatIdRef.current;
          if (currentChatId && msg.title) {
            const currentNotes = getNotesForChatRef(currentChatId);
            const searchTitle = msg.title.toLowerCase().trim();
            const foundNote = currentNotes.find(n => n.title.toLowerCase().includes(searchTitle));
            if (foundNote) {
              updateDoc(doc(db, "chats", currentChatId), {
                activeNoteId: foundNote.id
              }).then(() => {
                setActiveNoteId(foundNote.id);
                setLocalModernContent(foundNote.content || "");
                setStatus(`Zobrazeno: ${foundNote.title}`);
              }).catch(err => {
                console.error("Error selecting note from WS:", err);
              });
            } else {
              setStatus(`Nenalezena: ${msg.title}`);
            }
          }
          return;
        }

        if (msg.type === "create_folder") {
          const currentChatId = activeChatIdRef.current;
          if (currentChatId && msg.title) {
            const activeChat = chatsRef.current.find(c => c.id === currentChatId);
            const currentFolders = activeChat?.folders || [];
            const newFolder = {
              id: `folder_${Date.now()}`,
              title: msg.title.trim(),
              parentId: msg.parentId || null,
              isCollapsed: false
            };
            updateDoc(doc(db, "chats", currentChatId), {
              folders: [...currentFolders, newFolder]
            }).then(() => {
              setStatus(`Složka: ${msg.title}`);
            }).catch(err => {
              console.error("Error creating folder from WS:", err);
            });
          }
          return;
        }

        if (msg.type === "toggle_folder") {
          const currentChatId = activeChatIdRef.current;
          if (currentChatId && msg.title) {
            const activeChat = chatsRef.current.find(c => c.id === currentChatId);
            const currentFolders = activeChat?.folders || [];
            const searchTitle = msg.title.toLowerCase().trim();
            const updatedFolders = currentFolders.map((f: any) => {
              if (f.title.toLowerCase().includes(searchTitle)) {
                return { ...f, isCollapsed: msg.isCollapsed !== false };
              }
              return f;
            });
            updateDoc(doc(db, "chats", currentChatId), {
              folders: updatedFolders
            }).then(() => {
              setStatus(`Složka ${msg.title} ${msg.isCollapsed ? "zavinuta" : "rozvinuta"}`);
            }).catch(err => {
              console.error("Error toggling folder from WS:", err);
            });
          }
          return;
        }

        if (msg.type === "move_note") {
          const currentChatId = activeChatIdRef.current;
          if (currentChatId && msg.noteTitle) {
            const activeChat = chatsRef.current.find(c => c.id === currentChatId);
            const currentNotes = activeChat?.notes || [];
            const currentFolders = activeChat?.folders || [];
            
            const searchNoteTitle = msg.noteTitle.toLowerCase().trim();
            const targetNote = currentNotes.find((n: any) => n.title.toLowerCase().includes(searchNoteTitle));
            
            if (targetNote) {
              let targetFolderId: string | null = null;
              if (msg.folderTitle) {
                const searchFolderTitle = msg.folderTitle.toLowerCase().trim();
                const targetFolder = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchFolderTitle));
                if (targetFolder) {
                  targetFolderId = targetFolder.id;
                }
              }

              const updatedNotes = currentNotes.map((n: any) => {
                if (n.id === targetNote.id) {
                  return { ...n, folderId: targetFolderId };
                }
                return n;
              });

              updateDoc(doc(db, "chats", currentChatId), {
                notes: updatedNotes
              }).then(() => {
                setStatus(`Přesunuto: ${targetNote.title}`);
              }).catch(err => {
                console.error("Error moving note from WS:", err);
              });
            } else {
              setStatus(`Poznámka nenalezena: ${msg.noteTitle}`);
            }
          }
          return;
        }

        if (msg.type === "select_chat") {
          if (msg.title) {
            const searchTitle = msg.title.toLowerCase().trim();
            const foundChat = chatsRef.current.find(c => c.title.toLowerCase().includes(searchTitle));
            if (foundChat) {
              setActiveChatId(foundChat.id);
              setStatus(`Přepnuto na chat: ${foundChat.title}`);
            } else {
              setStatus(`Chat: "${msg.title}" nenalezen.`);
            }
          }
          return;
        }

        if (msg.type === "rename_folder") {
          const currentChatId = activeChatIdRef.current;
          if (currentChatId && msg.oldTitle && msg.newTitle) {
            const activeChat = chatsRef.current.find(c => c.id === currentChatId);
            const currentFolders = activeChat?.folders || [];
            const searchTitle = msg.oldTitle.toLowerCase().trim();
            const updatedFolders = currentFolders.map((f: any) => {
              if (f.title.toLowerCase().includes(searchTitle)) {
                return { ...f, title: msg.newTitle.trim() };
              }
              return f;
            });
            updateDoc(doc(db, "chats", currentChatId), {
              folders: updatedFolders
            }).then(() => {
              setStatus(`Složka přejmenována na: ${msg.newTitle}`);
            }).catch(err => {
              console.error("Error renaming folder from WS:", err);
            });
          }
          return;
        }

        if (msg.type === "delete_folder") {
          const currentChatId = activeChatIdRef.current;
          if (currentChatId && msg.title) {
            const activeChat = chatsRef.current.find(c => c.id === currentChatId);
            if (activeChat) {
              const currentFolders = activeChat.folders || [];
              const searchTitle = msg.title.toLowerCase().trim();
              const folderToDelete = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchTitle));
              if (folderToDelete) {
                const folderId = folderToDelete.id;
                const updatedFolders = currentFolders.filter((f: any) => f.id !== folderId);
                const newParentId = folderToDelete.parentId || null;
                const updatedFoldersFinal = updatedFolders.map((f: any) => {
                  if (f.parentId === folderId) {
                    return { ...f, parentId: newParentId };
                  }
                  return f;
                });
                const currentNotes = getNotesForChatRef(currentChatId);
                const updatedNotes = currentNotes.map((n: any) => {
                  if (n.folderId === folderId) {
                    return { ...n, folderId: newParentId };
                  }
                  return n;
                });
                updateDoc(doc(db, "chats", currentChatId), {
                  folders: updatedFoldersFinal,
                  notes: updatedNotes
                }).then(() => {
                  setStatus(`Smazána složka: ${folderToDelete.title}`);
                }).catch(err => {
                  console.error("Error deleting folder from WS:", err);
                });
              }
            }
          }
          return;
        }

        if (msg.type === "move_folder") {
          const currentChatId = activeChatIdRef.current;
          if (currentChatId && msg.folderTitle) {
            const activeChat = chatsRef.current.find(c => c.id === currentChatId);
            if (activeChat) {
              const currentFolders = activeChat.folders || [];
              const searchFolderTitle = msg.folderTitle.toLowerCase().trim();
              const targetFolder = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchFolderTitle));
              if (targetFolder) {
                let parentFolderId: string | null = null;
                if (msg.parentFolderTitle) {
                  const searchParentTitle = msg.parentFolderTitle.toLowerCase().trim();
                  const parentFolder = currentFolders.find((f: any) => f.title.toLowerCase().includes(searchParentTitle));
                  if (parentFolder && parentFolder.id !== targetFolder.id) {
                    parentFolderId = parentFolder.id;
                  }
                }
                const updatedFolders = currentFolders.map((f: any) => {
                  if (f.id === targetFolder.id) {
                    return { ...f, parentId: parentFolderId };
                  }
                  return f;
                });
                updateDoc(doc(db, "chats", currentChatId), {
                  folders: updatedFolders
                }).then(() => {
                  setStatus(`Složka ${targetFolder.title} přesunuta.`);
                }).catch(err => {
                  console.error("Error moving folder from WS:", err);
                });
              }
            }
          }
          return;
        }

        if (msg.type === "rename_chat" || msg.type === "rename_note") {
          const currentChatId = activeChatIdRef.current;
          const currentActiveNoteId = activeNoteIdRef.current || "default";
          if (currentChatId && msg.title) {
            const currentNotes = getNotesForChatRef(currentChatId);
            const updatedNotes = currentNotes.map((n: any) => {
              if (n.id === currentActiveNoteId) {
                return { ...n, title: msg.title.trim() };
              }
              return n;
            });

            updateDoc(doc(db, "chats", currentChatId), {
              notes: updatedNotes,
              title: msg.title.trim()
            }).then(() => {
              setStatus(`Přejmenováno: ${msg.title}`);
            }).catch(err => {
              console.error("Error renaming note/chat from WS:", err);
            });
          }
          return;
        }

        if (msg.type === "update_profile_memo") {
          if (msg.memo !== undefined) {
            setUserProfileMemo(msg.memo || "");
            saveUserProfileMemo(msg.memo || "");
            setStatus("Zapamatováno");
          }
          return;
        }

        if (msg.type === "research_started") {
          setResearchStatus("searching");
          setResearchTopic(msg.topic);
          setResearchResult("");
          setResearchSources([]);
          setStatus(`Průzkum na pozadí: "${msg.topic}"`);
          return;
        }

        if (msg.type === "research_ready") {
          setResearchStatus("ready");
          setResearchTopic(msg.topic);
          setResearchResult(msg.result || "");
          setStatus(`Hotovo: "${msg.topic}"`);
          handleNewCardGenerated(msg.topic, msg.result || "", "Denní plán");
          return;
        }

        if (msg.type === "research_error") {
          setResearchStatus("idle");
          setStatus("Chyba vyhledávání");
          return;
        }

        if (msg.type === "display_study_card") {
          const resolvedSubject = msg.subject || "Denní plán";
          setCustomCard({
            topic: msg.topic,
            content: msg.content,
            subject: resolvedSubject
          });
          setResearchStatus("idle");
          setStatus(`Zobrazen plán: ${msg.topic}`);
          handleNewCardGenerated(
            msg.topic, 
            msg.content, 
            resolvedSubject, 
            undefined, 
            undefined, 
            undefined, 
            msg.targetDateStr
          );

          if (msg.targetDateStr) {
            const parts = msg.targetDateStr.split('-');
            if (parts.length === 3) {
              const tgtDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
              setSelectedDate(tgtDate);
            }
          }
          return;
        }

        if (msg.type === "hide_card") {
          setCustomCard(null);
          setResearchStatus("idle");
          setStatus("Karta skryta");
          return;
        }

        if (msg.type === "switch_view_day") {
          if (msg.targetDateStr) {
            let targetDate = new Date();
            const lowerStr = msg.targetDateStr.toLowerCase();
            if (lowerStr === "today" || lowerStr === "dnes") {
              targetDate = new Date();
            } else if (lowerStr === "tomorrow" || lowerStr === "zítra" || lowerStr === "zitra") {
              const d = new Date();
              d.setDate(d.getDate() + 1);
              targetDate = d;
            } else if (lowerStr === "yesterday" || lowerStr === "včera" || lowerStr === "vcera") {
              const d = new Date();
              d.setDate(d.getDate() - 1);
              targetDate = d;
            } else {
              const parts = msg.targetDateStr.split('-');
              if (parts.length === 3) {
                targetDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
              }
            }
            setSelectedDate(targetDate);
            setStatus(`Přepnuto na datum: ${targetDate.toLocaleDateString("cs-CZ")}`);
          }
          return;
        }

        if (msg.type === "delete_plan_for_day") {
          if (msg.targetDateStr) {
            const tgtSubject = msg.subject;
            if (tgtSubject) {
              const cardToDelete = savedCards.find(card => 
                (card as any).targetDateStr === msg.targetDateStr && 
                card.subject === tgtSubject
              );
              if (cardToDelete) {
                deleteCardFromDb(cardToDelete.id);
                setStatus(`Karta '${tgtSubject}' pro den ${msg.targetDateStr} byla vymazána.`);
              } else {
                setStatus(`Nenalezena karta '${tgtSubject}' pro den ${msg.targetDateStr}.`);
              }
            } else {
              const cardsToDelete = savedCards.filter(card => (card as any).targetDateStr === msg.targetDateStr);
              if (cardsToDelete.length > 0) {
                cardsToDelete.forEach(card => deleteCardFromDb(card.id));
                setStatus(`Všechny panely pro den ${msg.targetDateStr} byly vymazány.`);
              } else {
                setStatus(`Nebyly nalezeny žádné karty k vymazání pro ${msg.targetDateStr}.`);
              }
            }
          }
          return;
        }

        if (msg.type === "open_settings_view") {
          setShowSettings(true);
          setStatus("Nastavení otevřeno");
          return;
        }

        if (msg.type === "close_settings_view") {
          setShowSettings(false);
          setStatus("Nastavení zavřeno");
          return;
        }

        if (msg.type === "switch_panel") {
          const panel = msg.panel || "Denní plán";
          if (panel.toLowerCase().includes("ranní") || panel.toLowerCase().includes("morning")) {
            setActivePanelType('morning');
          } else if (panel.toLowerCase().includes("večerní") || panel.toLowerCase().includes("evening")) {
            setActivePanelType('evening');
          } else {
            setActivePanelType('general');
          }
          setStatus(`Přepnuto na panel: ${panel}`);
          return;
        }

        if (msg.serverContent?.modelTurn?.parts) {
          msg.serverContent.modelTurn.parts.forEach((part: any) => {
            if (part.inlineData?.data) {
              playAudioChunk(part.inlineData.data);
              setIsAiSpeaking(true);
            }
          });
        }

        if (msg.serverContent?.interrupted) {
          stopAudioPlayback();
          setIsAiSpeaking(false);
          isNewTurnRef.current = true;
          const ut = userTranscriptRef.current;
          const at = assistantTranscriptRef.current;
          if (ut.trim() || at.trim()) {
            setChatHistory(prev => [
              ...prev,
              {
                id: Math.random().toString(36).substring(7),
                userText: ut,
                assistantText: at,
                timestamp: new Date()
              }
            ]);
            saveSpeechMessageToDb(ut, at);
            setUserTranscript("");
            setAssistantTranscript("");
          }
        }

        if (msg.serverContent?.turnComplete) {
          isNewTurnRef.current = true;
          setIsAiSpeaking(false);
          const ut = userTranscriptRef.current;
          const at = assistantTranscriptRef.current;
          if (ut.trim() || at.trim()) {
            setChatHistory(prev => [
              ...prev,
              {
                id: Math.random().toString(36).substring(7),
                userText: ut,
                assistantText: at,
                timestamp: new Date()
              }
            ]);
            saveSpeechMessageToDb(ut, at);
            setUserTranscript("");
            setAssistantTranscript("");
          }
        }

        if (msg.type === "transcription") {
          if (msg.role === "user") {
            if (isNewTurnRef.current) {
              setUserTranscript("");
              setAssistantTranscript("");
              isNewTurnRef.current = false;
            }
            setUserTranscript(prev => prev + msg.text);
          } else if (msg.role === "assistant") {
            if (isNewTurnRef.current) {
              setAssistantTranscript("");
              isNewTurnRef.current = false;
            }
            setAssistantTranscript(prev => prev + msg.text);
          }
          return;
        }

        if (msg.inputTranscription?.text) {
          setUserTranscript(prev => prev + msg.inputTranscription.text);
        }

        if (msg.outputTranscription?.text) {
          if (isNewTurnRef.current) {
            setAssistantTranscript("");
            isNewTurnRef.current = false;
          }
          setAssistantTranscript(prev => prev + msg.outputTranscription.text);
        }

        if (msg.serverContent?.modelTurn) {
          if (isNewTurnRef.current) {
            setAssistantTranscript("");
            isNewTurnRef.current = false;
          }
          msg.serverContent.modelTurn.parts.forEach((part: any) => {
            if (part.text) {
              setAssistantTranscript(prev => prev + part.text);
            }
            if (part.audioTranscription?.text) {
              setAssistantTranscript(prev => prev + part.audioTranscription.text);
            }
          });
        }

        if (msg.serverContent?.userTurn) {
          stopAudioPlayback();
          const ut = userTranscriptRef.current;
          const at = assistantTranscriptRef.current;
          if (ut.trim() || at.trim()) {
            setChatHistory(prev => [
              ...prev,
              {
                id: Math.random().toString(36).substring(7),
                userText: ut,
                assistantText: at,
                timestamp: new Date()
              }
            ]);
            saveSpeechMessageToDb(ut, at);
          }
          setUserTranscript("");
          setAssistantTranscript("");
          isNewTurnRef.current = false;
        }
      };

      ws.onclose = () => stopSession();
      ws.onerror = () => setStatus("Chyba spojení");

    } catch (err: any) {
      console.error("Session start crash:", err);
      
      let friendlyMessage = "Při zahájení relace došlo k chybě. Ověřte prosím, že systém nebo prohlížeč neblokuje přístup k mikrofonu.";
      let errType: "mic" | "camera" | "general" = "general";

      const errName = err?.name || "";
      const errMsg = err?.message || "";

      if (errName === "NotAllowedError" || errName === "PermissionDeniedError" || errMsg.toLowerCase().includes("permission denied")) {
        friendlyMessage = "Přístup k mikrofonu byl zamítnut.\n\nPokud jste mikrofon již povolili, prohlížeč přesto blokuje přístup, protože aplikace běží uvnitř zabezpečeného rámu (iframe) v AI Studio.\n\n👉 Klikněte prosím na tlačítko 'Otevřít v samostatné záložce' (ikona šipky ven z okna) v pravém horním rohu náhledu nad aplikací, aby mohl prohlížeč bezpečně zvuk nahrávat.";
        errType = "mic";
      } else if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
        friendlyMessage = "Nebylo nalezeno žádné funkční mikrofonní zařízení. Zkontrolujte připojení mikrofonu a zkuste to znovu.";
        errType = "mic";
      } else if (errName === "SecurityError") {
        friendlyMessage = "Přístup k mikrofonu je blokován z bezpečnostních důvodů (spuštění v izolovaném iframe rámu přehrávače). Klikněte prosím na tlačítko 'Otevřít v nové záložce' (Open in separate tab) v pravém horním rohu AI Studio rozhraní, aby měl prohlížeč přímý přístup pro registraci zvukového vstupu.";
        errType = "mic";
      } else if (errMsg.toLowerCase().includes("permission")) {
        friendlyMessage = "Oprávnění k mikrofonu je vyžadováno pro živou hlasovou komunikaci se Shate. Spusťte prosím aplikaci v samostatné záložce.";
        errType = "mic";
      }

      setPermissionError({
        type: errType,
        message: friendlyMessage
      });
      setStatus("Chyba oprávnění");
    }
  };

  const stopSession = () => {
    setIsConnected(false);
    setStatus("Hovor vypnut");
    setIsAiSpeaking(false);
    isNewTurnRef.current = true;
    
    stopAudioPlayback();

    const ut = userTranscriptRef.current;
    const at = assistantTranscriptRef.current;
    if (ut.trim() || at.trim()) {
      setChatHistory(prev => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          userText: ut,
          assistantText: at,
          timestamp: new Date()
        }
      ]);
      saveSpeechMessageToDb(ut, at);
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    
    setAssistantTranscript("");
    setUserTranscript("");
  };

  const startAudioProcessing = () => {
    if (!audioCtxRef.current || !streamRef.current || !wsRef.current) return;
    const source = audioCtxRef.current.createMediaStreamSource(streamRef.current);
    const processor = audioCtxRef.current.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    source.connect(processor);
    processor.connect(audioCtxRef.current.destination);

    processor.onaudioprocess = (e) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const inputData = e.inputBuffer.getChannelData(0);
      const base64 = pcmToBase64(inputData);
      wsRef.current.send(JSON.stringify({ audio: base64 }));
    };
  };

  const playAudioChunk = (base64: string) => {
    if (!audioCtxRef.current) return;
    const data = base64ToFloat32(base64);
    const buffer = audioCtxRef.current.createBuffer(1, data.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(data);

    const source = audioCtxRef.current.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = voiceSpeed;
    source.connect(audioCtxRef.current.destination);

    activeSourcesRef.current.push(source);

    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
      const now = audioCtxRef.current?.currentTime || 0;
      if (nextStartTimeRef.current <= now) {
        setIsAiSpeaking(false);
      }
    };

    const now = audioCtxRef.current.currentTime;
    if (nextStartTimeRef.current < now) {
      nextStartTimeRef.current = now + 0.05;
    }

    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += (buffer.duration / voiceSpeed);
  };

  const stopAudioPlayback = () => {
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch {}
    });
    activeSourcesRef.current = [];
    nextStartTimeRef.current = audioCtxRef.current?.currentTime || 0;
    setIsAiSpeaking(false);
  };

  let activeCard: { id?: string; topic: string; content: string; subject?: string; } | null = null;
  if (activeCardId) {
    activeCard = savedCards.find(c => c.id === activeCardId) || null;
  }
  if (!activeCard && customCard) {
    activeCard = customCard;
  }
  if (!activeCard && researchStatus === "ready") {
    activeCard = { topic: researchTopic, content: researchResult, subject: researchSubject };
  }

  const isSearching = researchStatus === "searching";

  if (!user) {
    return (
      <div className="min-h-screen bg-[#060813] text-zinc-100 font-sans selection:bg-indigo-900/40 overflow-hidden relative flex flex-col items-center justify-center p-4">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-[#4f5ff7]/5 blur-[120px] rounded-full pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative max-w-sm w-full bg-[#111322] border border-white/[5%] rounded-[24px] p-8 shadow-[0_20px_50px_rgba(0,0,0,0.6)] flex flex-col items-center text-center z-10"
        >
          <div className="relative mb-5 flex items-center justify-center select-none">
            <div className="w-12 h-12 bg-indigo-900/20 border border-[#4f5ff7]/25 rounded-2xl flex items-center justify-center shadow-lg">
              <Sparkles className="w-5 h-5 text-[#4f5ff7]" />
            </div>
          </div>

          <h1 className="text-lg font-black tracking-widest text-zinc-100 mb-1">
            Shate AI
          </h1>
          <p className="text-[10px] font-mono tracking-widest text-[#4f5ff7] uppercase mb-6 font-bold">
            Day & Routine Planner
          </p>

          <p className="text-zinc-400 text-xs min-h-[40px] leading-relaxed mb-6 max-w-[280px]">
            Tvůj asistent na plánování rutiny a celého dne.
          </p>

          <div className="w-full space-y-3">
            <button
              onClick={loginWithGoogle}
              disabled={isLoggingIn}
              className="w-full h-11 px-4 bg-zinc-100 hover:bg-white text-zinc-950 font-bold text-xs tracking-wider rounded-xl cursor-pointer pointer-events-auto transition-all shadow-md active:scale-98 disabled:scale-100 disabled:opacity-50 flex items-center justify-center gap-2 uppercase"
            >
              {isLoggingIn ? (
                <div className="w-4 h-4 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Přihlásit se přes Google</span>
                </>
              )}
            </button>

            <button
              onClick={loginAsGuest}
              disabled={isLoggingIn}
              className="w-full h-11 px-4 bg-[#131523] border border-white/[5%] hover:border-white/[12%] text-zinc-300 hover:text-white font-semibold text-xs tracking-wider rounded-xl cursor-pointer pointer-events-auto transition-all active:scale-98 disabled:scale-100 disabled:opacity-50 flex items-center justify-center gap-2 uppercase"
            >
              <span>Pokračovat jako host</span>
            </button>
          </div>

          {authError && (
            <p className="text-zinc-500 text-[10px] leading-relaxed mt-4 font-medium px-2 bg-rose-950/10 border border-rose-500/25 py-2 rounded-lg w-full">
              {authError}
            </p>
          )}
        </motion.div>
      </div>
    );
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    setStatus(`Zpracovávám puštěný soubor ${file.name}...`);

    const isText = 
      file.type.startsWith("text/") || 
      /\.(txt|md|json|csv|js|ts|py|html|css|yaml|yml)$/i.test(file.name);

    const isImage = file.type.startsWith("image/");
    const isPDF = file.type === "application/pdf";

    const reader = new FileReader();

    if (isText) {
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setAttachedFile({
          name: file.name,
          type: file.type || "text/plain",
          size: file.size,
          textContent: text
        });
        setStatus(`Textový soubor ${file.name} připojen`);
      };
      reader.readAsText(file);
    } else if (isImage || isPDF) {
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setAttachedFile({
          name: file.name,
          type: file.type,
          size: file.size,
          base64: base64
        });
        setStatus(`Soubor ${file.name} připojen k analýze`);
      };
      reader.readAsDataURL(file);
    } else {
      const isSmall = file.size < 100 * 1024;
      if (isSmall) {
        reader.onload = (event) => {
          const text = event.target?.result as string;
          setAttachedFile({
            name: file.name,
            type: "text/plain",
            size: file.size,
            textContent: text
          });
          setStatus(`Soubor ${file.name} připojen jako text`);
        };
        reader.readAsText(file);
      } else {
        reader.onload = (event) => {
          const base64 = event.target?.result as string;
          setAttachedFile({
            name: file.name,
            type: file.type || "application/octet-stream",
            size: file.size,
            base64: base64
          });
          setStatus(`Soubor ${file.name} připojen`);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  return (
    <div 
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="h-screen w-screen bg-[#070913] text-zinc-100 font-sans selection:bg-indigo-900/40 overflow-hidden relative flex flex-col md:flex-row"
    >
      
      {/* File Drop Overlay Indicators */}
      <AnimatePresence>
        {isDraggingFile && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-[#070913]/90 z-50 flex flex-col items-center justify-center p-8 border-4 border-dashed border-[#4f5ff7]/40 rounded-xl"
          >
            <div className="w-20 h-20 rounded-full bg-[#4f5ff7]/10 flex items-center justify-center text-[#4f5ff7] mb-4 animate-bounce">
              <UploadCloud className="w-10 h-10" />
            </div>
            <p className="text-sm font-bold text-zinc-200">Pusťte soubor sem pro nahrání do Shate</p>
            <p className="text-xs text-zinc-500 font-mono mt-1">(Podpora PDF, obrázků a textových dokumentů)</p>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Outer ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-indigo-500/[3%] blur-[120px] rounded-full pointer-events-none animate-pulse" />

      {isDesktop ? (
        /* ======================== DESKTOP INTERFACE (3-COLUMN SPLIT PANEL) ======================== */
        <div className="flex w-full h-full relative z-10 select-none">
          
          {/* COLUMN 1: POZNÁMKY (LEFT SIDEBAR) */}
          <aside className={`bg-[#090b17] border-white/[5%] flex flex-col shrink-0 shadow-lg transition-all duration-300 ease-in-out ${
            sidebarCollapsed ? "w-0 p-0 border-r-0 opacity-0 overflow-hidden" : "w-72 py-5 px-4 border-r"
          }`}>
            {/* Header / Brand */}
            <div className="flex items-center gap-3 pb-4 border-b border-white/[5%] select-none shrink-0 mb-4">
              <div className="w-8 h-8 rounded-xl bg-indigo-950/20 border border-[#4f5ff7]/25 flex items-center justify-center shadow-lg">
                <Zap className="w-4 h-4 text-[#4f5ff7] fill-[#4f5ff7]/10" />
              </div>
              <div className="flex flex-col text-left">
                <span className="text-sm font-black tracking-widest text-zinc-100 uppercase leading-none">Shate AI</span>
              </div>
            </div>

            {/* Title & Quick Actions */}
            <div className="flex items-center justify-between mb-3 select-none shrink-0">
              <span className="text-xs font-black tracking-widest text-zinc-400 uppercase">Poznámky</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => createNewNote(null)}
                  className="p-1.5 hover:bg-white/[5%] hover:text-[#00d2ff] rounded-lg transition-all cursor-pointer text-zinc-400"
                  title="Nová poznámka"
                >
                  <FilePlus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    setNewFolderTitleInput("");
                    setCreatingFolderInId("root");
                  }}
                  className="p-1.5 hover:bg-white/[5%] hover:text-[#00d2ff] rounded-lg transition-all cursor-pointer text-zinc-400"
                  title="Nová složka"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Folder & Notes list */}
            <div 
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const draggedId = e.dataTransfer.getData("text/plain");
                const draggedType = e.dataTransfer.getData("type");
                if (draggedType === "note") {
                  moveNoteToFolder(draggedId, null);
                } else if (draggedType === "folder") {
                  moveFolderToFolder(draggedId, null);
                }
              }}
              className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-1 select-text text-left min-h-0"
            >
              {/* Inline input for creating a folder at the root level */}
              {creatingFolderInId === "root" && (
                <div className="flex items-center gap-2 py-1 px-2 bg-white/[2%] rounded-lg border border-white/[5%] mb-2">
                  <FolderPlus className="w-3.5 h-3.5 text-amber-500/60 shrink-0" />
                  <input
                    value={newFolderTitleInput}
                    onChange={(e) => setNewFolderTitleInput(e.target.value)}
                    placeholder="Název složky..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (newFolderTitleInput.trim()) {
                          createFolder(newFolderTitleInput.trim(), null);
                        }
                        setCreatingFolderInId(null);
                      }
                      if (e.key === "Escape") setCreatingFolderInId(null);
                    }}
                    onBlur={() => {
                      if (newFolderTitleInput.trim()) {
                        createFolder(newFolderTitleInput.trim(), null);
                      }
                      setCreatingFolderInId(null);
                    }}
                    className="bg-transparent border-none focus:outline-none focus:ring-0 text-xs text-zinc-200 flex-1 min-w-0"
                    autoFocus
                  />
                </div>
              )}

              {/* Recursive render tree starting at null (root) */}
              {renderFolderTree(null) || (
                <div className="text-zinc-600 text-xs py-8 text-center italic select-none">
                  Žádné poznámky ani složky.<br />Vytvoř je kliknutím na ikony výše.
                </div>
              )}
            </div>

            {/* Collapsible/Compact Chat/Project Sessions Selector at the bottom */}
            <div className="mt-4 pt-3 border-t border-white/[4%] shrink-0 select-none">
              <details className="group">
                <summary className="list-none flex items-center justify-between text-[10px] font-mono tracking-wider text-zinc-500 uppercase font-bold cursor-pointer hover:text-zinc-300 transition-colors">
                  <span>Projekty / Chaty</span>
                  <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-2 space-y-1.5 max-h-[140px] overflow-y-auto custom-scrollbar select-text">
                  <button
                    onClick={() => createNewChatSession()}
                    className="w-full h-8 px-3 bg-white/[3%] hover:bg-[#4f5ff7] text-zinc-300 hover:text-white font-bold text-[10px] tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 uppercase mb-2"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Nový chat</span>
                  </button>
                  {chats.length === 0 ? (
                    <p className="text-zinc-700 text-[11px] text-center italic py-2">Žádné chaty</p>
                  ) : (
                    chats.map((chat) => {
                      const isActive = chat.id === activeChatId;
                      return (
                        <div
                          key={chat.id}
                          onClick={() => setActiveChatId(chat.id)}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-all duration-150 cursor-pointer ${
                            isActive
                              ? "bg-indigo-950/20 border-indigo-500/20 text-indigo-300"
                              : "bg-transparent border-transparent text-zinc-500 hover:bg-white/[2%] hover:text-zinc-300"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <MessageSquare className="w-3 h-3 shrink-0" />
                            <span className="text-xs truncate font-medium">{getChatDisplayTitle(chat)}</span>
                          </div>
                          <button
                            onClick={(e) => deleteChatSession(chat.id, e)}
                            className="hover:text-rose-400 p-0.5 rounded cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </details>
            </div>

            {/* Profile Bar / Sign Out */}
            <div className="pt-4 mt-3 border-t border-white/[5%] shrink-0 flex items-center justify-between select-none">
              <div className="flex items-center gap-2 min-w-0 max-w-[155px]">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/[10%] flex items-center justify-center text-zinc-100 font-bold font-sans text-xs shrink-0 truncate">
                  {(user?.displayName || "H").charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col text-left min-w-0">
                  <span className="text-[11px] font-bold text-zinc-300 truncate leading-tight">{user?.displayName || "Host"}</span>
                  <span className="text-[8.5px] font-mono text-[#4f5ff7] leading-none mt-0.5 truncate">{user?.email || "host@shate.ai"}</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowSettings(true)}
                  className="p-1.5 border border-white/[5%] bg-white/[0.01] hover:bg-white/[0.06] text-zinc-400 hover:text-white rounded-lg transition-all cursor-pointer flex items-center justify-center"
                  title="Nastavení"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleSignOut}
                  className="p-1.5 border border-rose-500/10 bg-transparent hover:bg-rose-500/15 text-zinc-400 hover:text-rose-400 rounded-lg transition-all cursor-pointer flex items-center justify-center"
                  title="Odhlásit se"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </aside>

          {/* COLUMN 2: POZNÁMKY (MIDDLE PANEL) */}
          <section className="flex-1 bg-[#080a15] border-r border-[#ffffff]/[5%] flex flex-col py-5 px-6 shrink-0 relative overflow-hidden select-text">
            {activeChatId ? (
              <div className="flex-1 flex flex-col h-full min-h-0 select-text font-sans">
                <div className={`bg-[#0b0d1a] border rounded-2xl flex-1 flex flex-col overflow-hidden shadow-[0_4px_35px_rgba(0,0,0,0.5)] relative transition-all duration-500 ${
                  isSubmittingText 
                    ? "border-[#00d2ff]/60 shadow-[0_0_35px_rgba(0,210,255,0.4)]" 
                    : isNotesFocused
                      ? "border-[#4f5ff7]/55 shadow-[0_0_24px_rgba(79,95,247,0.25)]"
                      : "border-white/[6%]"
                }`}>
                  {(() => {
                    const currentNotesList = getNotesForCurrentChat();
                    const activeNoteIndex = currentNotesList.findIndex(n => n.id === (activeNoteId || "default"));
                    const activeNoteObj = currentNotesList[activeNoteIndex] || currentNotesList[0];
                    return (
                      <div className="flex items-center justify-between px-5 py-3 border-b border-[#ffffff]/[4%] bg-[#0f1122]/60 shrink-0 select-none z-10">
                        <div className="flex items-center gap-1">
                          {/* Close/open Sidebar Toggle */}
                          <button
                            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                            className="p-1 rounded-lg border border-white/[5%] bg-white/[1%] hover:bg-white/[5%] text-zinc-400 hover:text-white transition-all cursor-pointer flex items-center justify-center"
                            title={sidebarCollapsed ? "Zobrazit boční panel" : "Skrýt boční panel"}
                          >
                            {sidebarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                          </button>
                        </div>

                        {/* Centered Switching with Chevrons */}
                        <div className="flex-1 flex items-center justify-center gap-3">
                          {/* Prev Note button */}
                          <button
                            onClick={handlePrevNote}
                            disabled={currentNotesList.length <= 1}
                            className="p-1 rounded-lg border border-white/[5%] bg-white/[1%] hover:bg-white/[5%] text-zinc-400 hover:text-white disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center"
                            title="Předchozí stránka poznámek"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>

                          {/* Display / Double-click Rename text */}
                          <div className="flex items-center gap-2">
                            {isRenamingActiveNote ? (
                              <input
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={async (e) => {
                                  if (e.key === "Enter") {
                                    if (renameValue.trim() && renameValue.trim() !== activeNoteObj?.title) {
                                      await renameNote(activeNoteObj?.id || "default", renameValue.trim());
                                    }
                                    setIsRenamingActiveNote(false);
                                  }
                                  if (e.key === "Escape") {
                                    setIsRenamingActiveNote(false);
                                  }
                                }}
                                onBlur={async () => {
                                  if (renameValue.trim() && renameValue.trim() !== activeNoteObj?.title) {
                                    await renameNote(activeNoteObj?.id || "default", renameValue.trim());
                                  }
                                  setIsRenamingActiveNote(false);
                                }}
                                className="bg-zinc-900 border border-indigo-500/40 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded-lg text-xs px-2 py-0.5 font-bold uppercase tracking-wider text-zinc-100 max-w-[140px] text-center"
                                autoFocus
                              />
                            ) : (
                              <span 
                                onDoubleClick={() => {
                                  setRenameValue(activeNoteObj?.title || "");
                                  setIsRenamingActiveNote(true);
                                }}
                                className="text-xs font-black tracking-widest text-[#00d2ff] uppercase hover:text-white transition-colors cursor-pointer select-none"
                                title="Dvojklik pro přejmenování"
                              >
                                {activeNoteObj?.title || "Hlavní poznámka"}
                              </span>
                            )}

                            {!isRenamingActiveNote && (
                              <button
                                onClick={() => {
                                  setRenameValue(activeNoteObj?.title || "");
                                  setIsRenamingActiveNote(true);
                                }}
                                className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                                title="Přejmenovat poznámku"
                              >
                                <Edit className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {/* Next Note button */}
                          <button
                            onClick={handleNextNote}
                            disabled={currentNotesList.length <= 1}
                            className="p-1 rounded-lg border border-white/[5%] bg-white/[1%] hover:bg-white/[5%] text-zinc-400 hover:text-white disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center"
                            title="Další stránka poznámek"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Right action control (plus, trash) */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => createNewNote()}
                            className="p-1 px-2 rounded-lg bg-[#4f5ff7]/10 border border-[#4f5ff7]/30 hover:bg-[#4f5ff7]/25 text-[#7f8ff7] hover:text-white transition-all cursor-pointer flex items-center gap-1 text-[9.5px] uppercase font-mono font-bold"
                            title="Vytvořit novou stránku"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Nová</span>
                          </button>

                          {currentNotesList.length > 1 && (
                            <button
                              onClick={(e) => deleteNote(activeNoteObj?.id || "default", e as any)}
                              className="p-1 rounded-lg bg-rose-500/5 border border-rose-500/20 hover:bg-rose-500/15 hover:border-rose-500/40 text-rose-400 hover:text-rose-300 transition-all cursor-pointer"
                              title="Smazat tuto stránku poznámek"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                   {/* Subtle glowing blue mist under editing or generating */}
                   <AnimatePresence>
                     {(isNotesFocused || isSubmittingText) && (
                       <motion.div
                         initial={{ opacity: 0, scale: 0.8 }}
                         animate={{ 
                           opacity: isSubmittingText ? 0.95 : 0.85, 
                           scale: isSubmittingText ? [0.95, 1.15, 0.95] : 1 
                         }}
                         exit={{ opacity: 0, scale: 0.8 }}
                         transition={{ 
                           duration: isSubmittingText ? 2.5 : 0.6,
                           repeat: isSubmittingText ? Infinity : 0,
                           ease: "easeInOut"
                         }}
                         className={`absolute right-1/4 bottom-1/4 w-[280px] h-[280px] blur-[90px] rounded-full pointer-events-none z-0 ${
                           isSubmittingText ? "bg-[#00d2ff]/15" : "bg-[#4f5ff7]/10"
                         }`}
                       />
                     )}
                   </AnimatePresence>

                  <div className="flex-1 p-6 relative flex flex-col min-h-0 text-left z-10">
                    {isNotesFocused ? (
                      <textarea
                        ref={textareaRef}
                        value={localModernContent}
                        onChange={(e) => setLocalModernContent(e.target.value)}
                        onBlur={handleNotesBlur}
                        className="w-full h-full bg-transparent border-0 outline-none focus:outline-none focus:ring-0 text-neutral-200 text-xs px-2 py-1 font-sans leading-relaxed resize-none custom-scrollbar flex-1 min-h-[300px]"
                        placeholder="Sem napište své poznámky..."
                        autoFocus
                      />
                    ) : (
                      <div 
                        onClick={() => {
                          setIsNotesFocused(true);
                          setTimeout(() => {
                            textareaRef.current?.focus();
                          }, 50);
                        }}
                        className="w-full h-full overflow-y-auto cursor-text px-2 py-1 select-text custom-scrollbar space-y-2 flex-1 min-h-[300px] leading-relaxed"
                      >
                        {localModernContent ? (
                          <MarkdownRenderer text={localModernContent} />
                        ) : (
                          <span className="text-zinc-500 text-xs italic select-none">Sem napište své poznámky... (Kliknutím začnete editovat)</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-4 select-none">
                <div className="w-14 h-14 bg-indigo-950/20 border border-indigo-505/10 rounded-2xl flex items-center justify-center text-indigo-400 shadow-md">
                  <File className="w-6 h-6 animate-pulse" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-zinc-200 text-sm font-bold tracking-tight">Otevřete rozhovor</h2>
                  <p className="text-zinc-550 text-xs leading-relaxed">
                    Vytvořte nebo vyberte chat k aktivaci svého poznámkového panelu.
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* COLUMN 3: ROZHOVOR (RIGHT CHATBOT COLUMN) */}
          <main className="w-96 bg-gradient-to-b from-[#101226] to-[#070814] flex flex-col relative overflow-hidden shrink-0 shadow-2xl border-l border-white/[4%]">
            {/* Header panel controller */}
            <div className="flex items-center px-5 py-4 border-b border-white/[5%] shrink-0 select-none">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]" : "bg-[#4f5ff7] shadow-[0_0_8px_rgba(79,95,247,0.7)]"} animate-pulse`} />
                <span className="text-[9px] font-mono tracking-widest text-zinc-550 uppercase font-bold">Asistent</span>
              </div>
            </div>

            {/* Chat conversation history & voice loop region */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4 select-text">
              {chatHistory.length === 0 ? null : (
                chatHistory.map((msg) => (
                  <div key={msg.id} className="space-y-1">
                    {msg.userText && (
                      <div className="flex justify-end">
                        <div className="bg-[#4f5ff7]/12 border border-[#4f5ff7]/25 text-zinc-100 text-xs max-w-[80%] rounded-[18px] rounded-tr-sm px-4 py-2.5 leading-relaxed antialiased font-semibold shadow-[0_2px_8px_rgba(79,95,247,0.03)] text-left font-sans">
                          {msg.userText}
                        </div>
                      </div>
                    )}
                    {msg.assistantText && (
                      <div className="flex justify-start">
                        <div className="bg-transparent border-transparent text-zinc-200 text-xs max-w-[85%] rounded-[18px] px-0.5 py-1 text-left">
                          <div className="font-sans font-bold text-[8px] font-mono tracking-wider text-[#4f5ff7] uppercase mb-1 flex items-center gap-1 select-none">
                            <Sparkles className="w-2.5 h-2.5" />
                            <span>Shate Asistent</span>
                          </div>
                          <div className="markdown-body antialiased leading-relaxed leading-6 bg-white/[0.02] border border-white/[5%] rounded-2xl px-4 py-3 text-zinc-200 select-text font-medium shadow-inner shadow-black/20">
                            <MarkdownRenderer text={msg.assistantText} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Real-time live floating conversation transcribing */}
              {isConnected && (userTranscript || assistantTranscript) && (
                <div className="space-y-3 opacity-95 animate-fade-in border-t border-dashed border-[#4f5ff7]/10 pt-4 mt-2">
                  {userTranscript && (
                    <div className="flex justify-end animate-fade-in">
                      <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs max-w-[80%] rounded-[18px] rounded-tr-sm px-4 py-2.5 leading-relaxed antialiased font-semibold shadow-[0_0_12px_rgba(16,185,129,0.08)] text-left flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                        <span>{userTranscript}</span>
                      </div>
                    </div>
                  )}
                  {assistantTranscript && (
                    <div className="flex justify-start animate-fade-in">
                      <div className="bg-transparent border-transparent text-zinc-200 text-xs max-w-[85%] rounded-[18px] px-0.5 py-1 text-left">
                        <div className="font-sans font-bold text-[8px] font-mono tracking-wider text-emerald-400 uppercase mb-1 flex items-center gap-1 my-0.5 select-none">
                          <Sparkles className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />
                          <span>Shate mluví (přepis)...</span>
                        </div>
                        <div className="markdown-body antialiased leading-relaxed leading-6 bg-white/[0.02] border border-emerald-500/20 rounded-2xl px-4 py-3 text-zinc-200 select-text font-medium shadow-[0_0_15px_rgba(16,185,129,0.04)]">
                          <MarkdownRenderer text={assistantTranscript} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Interactive Floating Pulse Sphere for active voice loop (glowing green) */}
              {isConnected && (
                <div className="py-6 flex flex-col items-center justify-center bg-emerald-500/[2%] border border-emerald-500/15 rounded-2xl mb-2 backdrop-blur-sm shadow-inner shrink-0 select-none animate-fade-in">
                  <div className="relative w-28 h-28 flex items-center justify-center">
                    <div className={`absolute inset-0 rounded-full bg-emerald-500/10 animate-ping duration-[3.5s] ${isAiSpeaking ? "opacity-65" : "opacity-20"}`} />
                    <div className={`absolute inset-3 rounded-full bg-gradient-to-tr from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 shadow-[0_0_24px_rgba(52,211,153,0.15)] ${isAiSpeaking ? "animate-pulse duration-[0.7s]" : "animate-pulse duration-[2s]"}`} />
                    <button
                      onClick={stopSession}
                      className="absolute inset-6 rounded-full bg-[#0a0b16] border border-red-500/35 hover:border-red-500/60 shadow-lg flex flex-col items-center justify-center cursor-pointer transition-all active:scale-95"
                    >
                      {isAiSpeaking ? (
                        <div className="flex items-center gap-1 h-4">
                          <span className="w-1 bg-emerald-400 h-3 rounded-full animate-wave-speed-1" />
                          <span className="w-1 bg-emerald-400 h-4 rounded-full animate-wave-speed-3" />
                          <span className="w-1 bg-emerald-400 h-2 rounded-full animate-wave-speed-5" />
                        </div>
                      ) : (
                        <PhoneOff className="w-4 h-4 text-rose-450 animate-pulse" />
                      )}
                    </button>
                  </div>
                  <span className="text-[9px] font-mono tracking-widest text-emerald-400 mt-3 uppercase font-black flex items-center gap-1.5 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    {isAiSpeaking ? "SHATE HOVOŘÍ..." : "SHATE POSLOUCHÁ"}
                  </span>
                </div>
              )}
            </div>

            {/* Bottom Form Fallback controls */}
            <div className="p-4 border-t border-white/[5%] shrink-0 flex flex-col bg-transparent select-none">
              {attachedFile && (
                <div className="mb-2 flex items-center justify-between bg-[#4f5ff7]/5 border border-[#4f5ff7]/15 rounded-xl px-3 py-1.5 animate-fade-in">
                  <div className="flex items-center gap-2 min-w-0">
                    <File className="w-3.5 h-3.5 text-[#4f5ff7] shrink-0" />
                    <span className="text-[10px] text-zinc-300 font-medium truncate max-w-[180px]">{attachedFile.name}</span>
                    <span className="text-[8px] text-zinc-500 font-mono shrink-0">({(attachedFile.size / 1024).toFixed(1)} KB)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAttachedFile(null)}
                    className="p-0.5 text-zinc-500 hover:text-white rounded hover:bg-white/[5%] cursor-pointer transition-all shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2">
                <PhotoManager
                  onSendImage={handleSendImage}
                  statusSetter={setStatus}
                />

                <FileUploader
                  onFileAttached={setAttachedFile}
                  attachedFile={attachedFile}
                  statusSetter={setStatus}
                />

                <form
                  onSubmit={handleSendTextMessage}
                  className={`relative flex items-center bg-[#131523]/70 border gap-2 rounded-xl transition-all duration-300 h-10 grow min-w-0 ${
                    isInputFocused ? "border-[#4f5ff7]/55 ring-1 ring-[#4f5ff7]/10" : "border-white/[4%]"
                  }`}
                >
                  <input
                    type="text"
                    placeholder="Mluv se Shate nebo napiš..."
                    value={textMessage}
                    onChange={(e) => setTextMessage(e.target.value)}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    disabled={isSubmittingText}
                    className="w-full bg-transparent text-[11px] text-zinc-100 placeholder-zinc-600 focus:outline-none pl-3.5 pr-9 py-2 rounded-xl leading-none"
                  />
                  <button
                    type="submit"
                    disabled={(!textMessage.trim() && !attachedFile) || isSubmittingText}
                    className="absolute right-1.5 p-1 rounded-lg bg-[#4f5ff7]/15 hover:bg-[#4f5ff7]/25 text-indigo-400 active:scale-95 transition-all cursor-pointer h-7 w-7 flex items-center justify-center disabled:opacity-30"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </form>

                <button
                  onClick={isConnected ? stopSession : startSession}
                  className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-300 cursor-pointer relative shrink-0 active:scale-90 ${
                    isConnected
                      ? "bg-emerald-550/20 border border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] animate-pulse scale-105"
                      : "bg-indigo-650/10 border border-[#4f5ff7]/15 text-[#4f5ff7] hover:text-white hover:bg-[#4f5ff7]/25 hover:scale-105 active:scale-95"
                  }`}
                  title={isConnected ? "Ukončit relaci" : "Zahájit Live hovor"}
                >
                  {isConnected ? (
                    <PhoneOff className="w-4 h-4 text-rose-450 animate-pulse" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Status footer bar */}
              <div className="flex justify-between items-center text-[8px] font-mono text-zinc-650 mt-2 select-none">
                <span>Verze 2.4</span>
                <span className="uppercase font-bold text-zinc-600">{status || "Systém připraven"}</span>
              </div>
            </div>
          </main>
        </div>
      ) : (
        /* ======================== MOBILE INTERFACE (3-TAB FLEXIBLE FLOW WITH SWIPE-ONLY OR COV PANEL RULES) ======================== */
        <div className="w-full max-w-sm h-full flex flex-col justify-between relative bg-gradient-to-b from-[#0a0c1a] to-[#04050d] mx-auto select-none overflow-hidden pb-4 shadow-[0_20px_50px_rgba(0,0,0,0.65)] z-15">
          {/* Header row */}
          <header className="flex items-center justify-between pb-3.5 border-b border-white/[4%] p-5 shrink-0 select-none">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-950/20 border border-[#4f5ff7]/25 flex items-center justify-center shadow-lg">
                <Zap className="w-4 h-4 text-[#4f5ff7] fill-[#4f5ff7]/10" />
              </div>
              <div className="flex flex-col text-left">
                <span className="text-xs font-black tracking-widest text-zinc-100 uppercase leading-none">Shate AI</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-white/[0.02] border border-white/[3%] px-2 py-1 rounded-lg text-[8px] font-mono uppercase tracking-wider text-zinc-400">
                <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)] animate-pulse" : "bg-zinc-650"}`} />
                <span>{isConnected ? "Aktivní" : "Spánek"}</span>
              </div>
              <button 
                onClick={() => setShowSettings(true)} 
                title="Nastavení"
                className="p-1.5 border border-white/[5%] bg-white/[0.02] hover:bg-white/[0.08] text-zinc-400 hover:text-white rounded-lg transition-all cursor-pointer flex items-center justify-center"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </header>

          {/* Core visual tabs area (Switchable via the outside mobile selector bar) */}
          <div className="flex-1 overflow-hidden min-h-0 relative">
            
            {/* TAB A: CHATBOT INTERACTIVE INTERFACE (The voice ball core & typing Fallout) */}
            {mobileTab === "chatbot" && (
              <div className="h-full flex flex-col justify-between p-5 min-h-0">
                <main className="flex-1 flex flex-col items-center justify-center py-2 min-h-0 relative">
                  
                  {/* Rotating pulsing sphere ball core */}
                  <div className="relative w-44 h-44 mb-4 flex items-center justify-center select-none shrink-0">
                    {isConnected && (
                      <>
                        <div className={`absolute inset-0 rounded-full bg-emerald-500/10 animate-ping duration-[3.5s] ${isAiSpeaking ? "opacity-65" : "opacity-20"}`} />
                        <div className={`absolute inset-4 rounded-full bg-gradient-to-tr from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.15)] ${isAiSpeaking ? "animate-pulse" : ""}`} />
                      </>
                    )}
                    <button 
                      onClick={isConnected ? stopSession : startSession}
                      className={`relative w-28 h-28 rounded-full flex flex-col items-center justify-center border transition-all duration-500 z-10 shadow-2xl cursor-pointer active:scale-95 ${
                        isConnected 
                          ? isAiSpeaking 
                            ? "bg-[#022c22]/95 border-emerald-500/60 shadow-[0_0_40px_rgba(16,185,129,0.45)]"
                            : "bg-[#011c15]/95 border-emerald-500/35 shadow-[0_0_20px_rgba(16,185,129,0.25)]"
                          : "bg-zinc-950/60 border-white/[5%] hover:border-white/[12%]"
                      }`}
                    >
                      <div className="relative">
                        {isConnected ? (
                          isAiSpeaking ? (
                            <div className="flex items-center gap-1.5 h-6">
                              <span className="w-1.5 h-5 bg-emerald-450 rounded-full animate-wave-speed-1" />
                              <span className="w-1.5 h-3 bg-emerald-350 rounded-full animate-wave-speed-2" />
                              <span className="w-1.5 h-6 bg-teal-400 rounded-full animate-wave-speed-3" />
                            </div>
                          ) : (
                            <div className="flex flex-col items-center font-sans">
                              <Mic className="w-7 h-7 text-emerald-400 animate-pulse duration-[1s]" />
                              <span className="text-[7.5px] font-mono tracking-widest text-emerald-400/80 uppercase font-black mt-2">AKTIVNÍ</span>
                            </div>
                          )
                        ) : (
                          <div className="flex flex-col items-center font-sans">
                            <Smartphone className="w-7 h-7 text-zinc-555" />
                            <span className="text-[7.5px] font-mono tracking-widest text-zinc-500 uppercase font-black mt-2">SPOJIT</span>
                          </div>
                        )}
                      </div>
                    </button>
                  </div>

                  {/* Message bubble stream or welcome screen summary */}
                  <div className="w-full flex-1 flex flex-col justify-center text-center space-y-4 px-2 select-text overflow-hidden">
                    <div className="min-h-[145px] max-h-[190px] overflow-y-auto custom-scrollbar flex flex-col justify-center py-1 px-1 text-zinc-100">
                      <AnimatePresence mode="wait">
                        {assistantTranscript ? (
                          <motion.div
                            key="speaking"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="text-xs font-semibold text-zinc-200 tracking-tight leading-relaxed max-w-xs mx-auto text-center font-sans"
                          >
                            <div className="markdown-body select-text drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)] antialiased bg-[#020309]/50 border border-white/[3%] px-3 py-2.5 rounded-2xl">
                              <MarkdownRenderer text={assistantTranscript} />
                            </div>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="idle"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-1 max-w-[260px] mx-auto font-sans"
                          >
                            <h2 className="text-zinc-200 text-xs font-extrabold tracking-tight">Jak tě mohu dnes naučit?</h2>
                            <p className="text-zinc-600 text-[10px] leading-relaxed">
                              Slyším tě a odpovídám v reálném čase. Klikni na mikrofon nebo nahraj fotku své látky a nechej si vygenerovat studijní plán!
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {isConnected && userTranscript && (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-[9px] font-mono text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 px-3 py-1 rounded-full max-w-xs mx-auto flex items-center justify-center gap-1.5 shrink-0"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping shrink-0" />
                        <span className="truncate max-w-[190px]">Slyším: "{userTranscript}"</span>
                      </motion.div>
                    )}
                  </div>
                </main>

                {/* Mobile Chat box Form entry */}
                <footer className="shrink-0 flex flex-col bg-transparent pt-2 border-t border-white/[3%] select-none">
                  {attachedFile && (
                    <div className="mb-2 flex items-center justify-between bg-[#4f5ff7]/5 border border-[#4f5ff7]/15 rounded-xl px-3 py-1.5 animate-fade-in mx-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <File className="w-3.5 h-3.5 text-[#4f5ff7] shrink-0" />
                        <span className="text-[10px] text-zinc-300 font-medium truncate max-w-[150px]">{attachedFile.name}</span>
                        <span className="text-[8px] text-zinc-500 font-mono shrink-0">({(attachedFile.size / 1024).toFixed(0)} KB)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAttachedFile(null)}
                        className="p-0.5 text-zinc-500 hover:text-white rounded hover:bg-white/[5%] cursor-pointer transition-all shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <PhotoManager
                      onSendImage={handleSendImage}
                      statusSetter={setStatus}
                    />

                    <FileUploader
                      onFileAttached={setAttachedFile}
                      attachedFile={attachedFile}
                      statusSetter={setStatus}
                    />

                    <form
                      onSubmit={handleSendTextMessage}
                      className="relative flex items-center bg-[#131523]/70 border border-white/[4%] gap-2 rounded-xl h-10 grow min-w-0"
                    >
                      <input
                        type="text"
                        placeholder="Napiš nebo se ptej..."
                        value={textMessage}
                        onChange={(e) => setTextMessage(e.target.value)}
                        disabled={isSubmittingText}
                        className="w-full bg-transparent text-[11px] text-zinc-100 placeholder-zinc-600 focus:outline-none pl-3.5 pr-9 py-2 rounded-xl leading-none"
                      />
                      <button
                        type="submit"
                        disabled={(!textMessage.trim() && !attachedFile) || isSubmittingText}
                        className="absolute right-1.5 p-1 rounded-lg bg-[#4f5ff7]/10 text-indigo-400 h-7 w-7 flex items-center justify-center disabled:opacity-30"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </form>

                    <button
                      onClick={isConnected ? stopSession : startSession}
                      className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer relative shrink-0 active:scale-90 ${
                        isConnected 
                          ? "bg-emerald-550/20 border border-emerald-500/50 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.25)] animate-pulse" 
                          : "bg-indigo-650/10 border border-[#4f5ff7]/15 text-[#4f5ff7]"
                      }`}
                    >
                      {isConnected ? <PhoneOff className="w-4 h-4 text-rose-400" /> : <Mic className="w-4 h-4" />}
                    </button>
                  </div>
                </footer>
              </div>
            )}

            {/* TAB B: MOJE CHATY (Conversations history panel) */}
            {mobileTab === "chats" && (
              <div className="h-full flex flex-col p-5 select-none text-left">
                <div className="flex justify-between items-center pb-3 border-b border-white/[4%] mb-4 shrink-0">
                  <span className="text-xs font-black tracking-wider text-[#4f5ff7] uppercase font-sans">Moje Projekty</span>
                  <button
                    onClick={() => {
                      createNewChatSession();
                      setMobileTab("chatbot");
                    }}
                    className="p-1 px-2.5 bg-[#4f5ff7] hover:bg-[#5f6ff7] text-white text-[9px] font-bold tracking-wider uppercase rounded-lg flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Nový</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 select-text pb-4">
                  {chats.length === 0 ? (
                    <p className="text-zinc-600 text-xs italic text-center py-6">Nemáš žádnou historii chatu</p>
                  ) : (
                    chats.map((chat) => {
                      const isActive = chat.id === activeChatId;
                      return (
                        <div
                          key={chat.id}
                          onClick={() => {
                            setActiveChatId(chat.id);
                            setMobileTab("chatbot");
                          }}
                          className={`flex items-center justify-between px-3.5 py-3 rounded-xl border transition-all duration-150 ${
                            isActive
                              ? "bg-indigo-950/15 border-indigo-500/20 text-white"
                              : "bg-transparent border-transparent text-zinc-400 hover:bg-white/[2%]"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <MessageSquare className="w-3.5 h-3.5 text-zinc-550 shrink-0" />
                            <span className="text-xs font-bold truncate capitalize leading-none">{getChatDisplayTitle(chat)}</span>
                          </div>
                          
                          <button
                            onClick={(e) => deleteChatSession(chat.id, e)}
                            className="text-zinc-550 hover:text-rose-400 p-1 rounded-md cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* TAB C: POZNÁMKY */}
            {mobileTab === "plan" && (
              <div className="h-full flex flex-col p-4 select-text text-left pb-16">
                {activeChatId ? (
                  <div className={`bg-[#0b0d1a] border rounded-2xl flex flex-col overflow-hidden shadow-[0_4px_35px_rgba(0,0,0,0.5)] relative flex-1 min-h-[300px] transition-all duration-500 ${
                    isSubmittingText 
                      ? "border-[#00d2ff]/60 shadow-[0_0_35px_rgba(0,210,255,0.4)]" 
                      : isNotesFocused
                        ? "border-[#4f5ff7]/55 shadow-[0_0_24px_rgba(79,95,247,0.25)]"
                        : "border-white/[6%]"
                  }`}>
                    {/* Header */}
                    {(() => {
                      const currentNotesList = getNotesForCurrentChat();
                      const activeNoteIndex = currentNotesList.findIndex(n => n.id === (activeNoteId || "default"));
                      const activeNoteObj = currentNotesList[activeNoteIndex] || currentNotesList[0];
                      return (
                        <div className="flex items-center justify-between px-3 py-2 border-b border-[#ffffff]/[4%] bg-[#0f1122]/60 shrink-0 select-none z-10 gap-1">
                          {/* Centered Switching with Chevrons */}
                          <div className="flex-1 flex items-center justify-center gap-1.5">
                            {/* Prev Note button */}
                            <button
                              onClick={handlePrevNote}
                              disabled={currentNotesList.length <= 1}
                              className="p-1 rounded-lg border border-white/[5%] bg-white/[1%] hover:bg-white/[5%] text-zinc-400 hover:text-white disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center"
                              title="Předchozí stránka"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>

                            {/* Display / Double-click Rename text */}
                            <div className="flex items-center gap-1">
                              {isRenamingActiveNote ? (
                                <input
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={async (e) => {
                                    if (e.key === "Enter") {
                                      if (renameValue.trim() && renameValue.trim() !== activeNoteObj?.title) {
                                        await renameNote(activeNoteObj?.id || "default", renameValue.trim());
                                      }
                                      setIsRenamingActiveNote(false);
                                    }
                                    if (e.key === "Escape") {
                                      setIsRenamingActiveNote(false);
                                    }
                                  }}
                                  onBlur={async () => {
                                    if (renameValue.trim() && renameValue.trim() !== activeNoteObj?.title) {
                                      await renameNote(activeNoteObj?.id || "default", renameValue.trim());
                                    }
                                    setIsRenamingActiveNote(false);
                                  }}
                                  className="bg-zinc-900 border border-indigo-500/40 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded-lg text-[10px] px-1.5 py-0.5 font-bold uppercase tracking-wider text-zinc-100 max-w-[100px] text-center"
                                  autoFocus
                                />
                              ) : (
                                <span 
                                  onDoubleClick={() => {
                                    setRenameValue(activeNoteObj?.title || "");
                                    setIsRenamingActiveNote(true);
                                  }}
                                  className="text-[10px] font-black tracking-widest text-[#00d2ff] uppercase hover:text-white transition-colors cursor-pointer select-none truncate max-w-[100px]"
                                  title="Dvojklik pro přejmenování"
                                >
                                  {activeNoteObj?.title || "Hlavní poznámka"}
                                </span>
                              )}

                              {!isRenamingActiveNote && (
                                <button
                                  onClick={() => {
                                    setRenameValue(activeNoteObj?.title || "");
                                    setIsRenamingActiveNote(true);
                                  }}
                                  className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                                  title="Přejmenovat"
                                >
                                  <Edit className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </div>

                            {/* Next Note button */}
                            <button
                              onClick={handleNextNote}
                              disabled={currentNotesList.length <= 1}
                              className="p-1 rounded-lg border border-white/[5%] bg-white/[1%] hover:bg-white/[5%] text-zinc-400 hover:text-white disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center"
                              title="Další stránka"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Right action control (plus, trash) */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => createNewNote()}
                              className="p-1 rounded-lg bg-[#4f5ff7]/10 border border-[#4f5ff7]/30 hover:bg-[#4f5ff7]/25 text-[#7f8ff7] hover:text-white transition-all cursor-pointer flex items-center justify-center"
                              title="Nová"
                            >
                              <Plus className="w-3 h-3" />
                            </button>

                            {currentNotesList.length > 1 && (
                              <button
                                onClick={(e) => deleteNote(activeNoteObj?.id || "default", e as any)}
                                className="p-1 rounded-lg bg-rose-500/5 border border-rose-500/20 hover:bg-rose-500/15 hover:border-rose-500/40 text-rose-450 hover:text-rose-350 transition-all cursor-pointer flex items-center justify-center"
                                title="Smazat"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Subtle glowing blue mist under editing or generating */}
                    <AnimatePresence>
                      {(isNotesFocused || isSubmittingText) && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ 
                            opacity: isSubmittingText ? 0.95 : 0.85, 
                            scale: isSubmittingText ? [0.95, 1.15, 0.95] : 1 
                          }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ 
                            duration: isSubmittingText ? 2.5 : 0.6,
                            repeat: isSubmittingText ? Infinity : 0,
                            ease: "easeInOut"
                          }}
                          className={`absolute right-1/4 bottom-1/4 w-[200px] h-[200px] blur-[80px] rounded-full pointer-events-none z-0 ${
                            isSubmittingText ? "bg-[#00d2ff]/15" : "bg-[#4f5ff7]/10"
                          }`}
                        />
                      )}
                    </AnimatePresence>

                    {/* Content Area */}
                    <div className="flex-1 p-4 relative flex flex-col min-h-0 text-left font-sans z-10">
                      {isNotesFocused ? (
                        <textarea
                          ref={mobileTextareaRef}
                          value={localModernContent}
                          onChange={(e) => setLocalModernContent(e.target.value)}
                          onBlur={handleNotesBlur}
                          className="w-full h-full bg-transparent border-0 outline-none focus:outline-none focus:ring-0 text-neutral-200 text-[11px] font-sans leading-relaxed resize-none custom-scrollbar flex-1"
                          placeholder="Napište své poznámky..."
                          autoFocus
                        />
                      ) : (
                        <div 
                          onClick={() => {
                            setIsNotesFocused(true);
                            setTimeout(() => {
                              mobileTextareaRef.current?.focus();
                            }, 50);
                          }}
                          className="w-full h-full overflow-y-auto cursor-text text-neutral-200 text-[11px] font-sans leading-relaxed custom-scrollbar space-y-2 flex-1"
                        >
                          {localModernContent ? (
                            <MarkdownRenderer text={localModernContent} />
                          ) : (
                            <span className="text-zinc-500 text-[11px] italic select-none">Napište své poznámky... (Klepnutím začnete editovat)</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center max-w-[210px] mx-auto space-y-3 py-16 select-none leading-normal">
                    <File className="w-6 h-6 text-indigo-500/30 animate-pulse" />
                    <p className="text-zinc-650 text-[10px] font-bold">Zatím nebyly uloženy žádné poznámky pro tento chat.</p>
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Clean OUTSIDE selectors toolbar at page base (satisfies user rules completely) */}
          <nav className="h-11 bg-[#090b17] border-t border-white/[5%] grid grid-cols-3 gap-2 px-3 pt-1 relative shrink-0 select-none">
            <button
              onClick={() => setMobileTab("chats")}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl transition-all cursor-pointer ${
                mobileTab === "chats" ? "text-[#4f5ff7] bg-white/[1.5%]" : "text-zinc-550 hover:text-zinc-300"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="text-[7.5px] font-mono tracking-wider font-extrabold uppercase">Projekty</span>
            </button>

            <button
              onClick={() => setMobileTab("chatbot")}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl transition-all cursor-pointer ${
                mobileTab === "chatbot" ? "text-[#4f5ff7] bg-white/[1.5%]" : "text-zinc-550 hover:text-zinc-300"
              }`}
            >
              <Mic className="w-3.5 h-3.5 animate-pulse" />
              <span className="text-[7.5px] font-mono tracking-wider font-extrabold uppercase">Asistent</span>
            </button>

            <button
              onClick={() => setMobileTab("plan")}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl transition-all cursor-pointer ${
                mobileTab === "plan" ? "text-[#4f5ff7] bg-white/[1.5%]" : "text-zinc-550 hover:text-zinc-300"
              }`}
            >
              <File className="w-3.5 h-3.5" />
              <span className="text-[7.5px] font-mono tracking-wider font-extrabold uppercase">Poznámky</span>
            </button>
          </nav>
        </div>
      )}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 30, stiffness: 350 }}
            className="absolute inset-0 bg-[#050711] z-50 flex flex-col p-5 md:p-10 select-text overflow-y-auto no-scrollbar font-sans"
          >
            {/* Upper Action Bar */}
            <div className="flex items-center justify-between border-b border-white/[4%] pb-4 mb-6 shrink-0 select-none max-w-5xl mx-auto w-full">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-1.5 px-3 rounded-lg border border-white/[5%] bg-white/[2%] hover:bg-white/[6%] text-zinc-300 hover:text-white transition-all cursor-pointer flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider"
                  title="Zpět do Shate AI"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-[#00d2ff]" />
                  <span>Zpět</span>
                </button>
                <div className="h-4 w-px bg-white/[8%]" />
                <h1 className="text-xs font-black tracking-widest text-[#4f5ff7] uppercase flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  <span>Nastavení a profil</span>
                </h1>
              </div>

              <div className="text-[9px] text-zinc-500 font-mono hidden md:block">
                ID relace: {activeChatId || "Není aktivní chat"}
              </div>
            </div>

            {/* Content Area (Responsive Bento Grid) */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-5xl mx-auto w-full mb-10">
              
              {/* LEFT / MAIN BENTO ITEM: MEMORY & PERSONALIZATION (Takes 7 cols) */}
              <div className="lg:col-span-7 bg-[#0b0d1a] border border-white/[5%] rounded-[24px] p-5 md:p-6 shadow-xl flex flex-col self-stretch min-h-[300px] w-full">
                <div className="flex items-center justify-between border-b border-white/[4%] pb-3 mb-4 shrink-0">
                  <h3 className="text-xs font-black tracking-widest text-zinc-200 uppercase flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#00d2ff] animate-pulse" />
                    <span>Paměť: Jak mě Shate zná</span>
                  </h3>
                  {isSavingProfileMemo && (
                    <span className="text-[9px] font-mono text-emerald-400 animate-pulse">Ukládání...</span>
                  )}
                </div>

                <p className="text-[11px] text-zinc-400 leading-relaxed mb-4 text-left">
                  Zde vidíš vše, co si o tobě Shate pamatuje. Kdykoliv mu v chatu nebo během hlasového hovoru řekneš něco o sobě (např. preference, zájmy, jméno, profil) a požádáš ho, aby si to zapamatoval, Shate si to sem sám uloží. Změny můžeš dělat i ručně níže:
                </p>

                {/* Profile Memory Editor */}
                <div className="flex-1 flex flex-col min-h-[160px]">
                  <textarea
                    value={userProfileMemo}
                    onChange={(e) => {
                      setUserProfileMemo(e.target.value);
                      saveUserProfileMemo(e.target.value); // Realtime auto-save as they type!
                    }}
                    placeholder="Např. Jmenuji se Tomáš, studuji design v Česku. Mám rád rychlé a stručné odpovědi a učím se nejraději ráno."
                    className="flex-1 w-full bg-black/40 border border-white/[7%] focus:border-[#4f5ff7]/40 focus:outline-none rounded-xl text-xs p-4 leading-relaxed text-zinc-200 font-sans tracking-wide resize-none select-text focus:ring-1 focus:ring-[#4f5ff7]/30 min-h-[120px]"
                  />
                  
                  <div className="flex items-center justify-between mt-3 text-[10px] text-zinc-500 font-mono select-none">
                    <span>Shate učí tvůj asistenční hlas tvé preference automaticky</span>
                    <button
                      onClick={() => saveUserProfileMemo(userProfileMemo)}
                      className="p-1 px-3 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/20 text-indigo-300 hover:text-white rounded-lg transition-all text-[9px] uppercase tracking-wider font-mono cursor-pointer font-bold"
                    >
                      Uložit profil
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGHT BENTO ITEMS: PREFERENCES & ACCOUNT (Takes 5 cols) */}
              <div className="lg:col-span-5 flex flex-col gap-6 w-full">
                
                {/* Pref 1: Voice speeds */}
                <div className="bg-[#0b0d1a] border border-white/[5%] rounded-[24px] p-5 shadow-xl">
                  <h3 className="text-xs font-black tracking-widest text-zinc-200 uppercase flex items-center gap-2 border-b border-white/[4%] pb-3 mb-4">
                    <Sliders className="w-4 h-4 text-indigo-400" />
                    <span>Hlasový asistent</span>
                  </h3>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[10px] font-mono tracking-wider text-zinc-400 uppercase font-bold">Rychlost řeči (TTS)</span>
                      <strong className="text-xs text-[#00d2ff] font-mono">{voiceSpeed.toFixed(1)}x</strong>
                    </div>
                    <input
                      type="range"
                      min="0.8"
                      max="2.0"
                      step="0.1"
                      value={voiceSpeed}
                      onChange={(e) => {
                        const speed = parseFloat(e.target.value);
                        setVoiceSpeed(speed);
                        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                          wsRef.current.send(JSON.stringify({
                            type: "voice_speed_changed",
                            speed: speed
                          }));
                        }
                      }}
                      className="w-full accent-[#4f5ff7] bg-white/[0.05] h-1.5 rounded-lg cursor-pointer"
                    />
                    <p className="text-[10px] text-zinc-550 leading-normal text-left">
                      Vyšší rychlost odpovídá přirozenějšímu tónu Shate v češtině. Výchozí je 1.4x.
                    </p>
                  </div>
                </div>

                {/* Pref 2: Gemini API key dynamic */}
                <div className="bg-[#0b0d1a] border border-white/[5%] rounded-[24px] p-5 shadow-xl">
                  <h3 className="text-xs font-black tracking-widest text-[#00d2ff] uppercase flex items-center gap-2 border-b border-white/[4%] pb-3 mb-4">
                    <Key className="w-4 h-4" />
                    <span>Připojení a Model</span>
                  </h3>

                  <div className="space-y-3 shrink-0">
                    {storedApiKeyExists ? (
                      <div className="flex items-center gap-2 bg-emerald-500/5 border border-emerald-500/10 p-2.5 rounded-xl text-[10px] text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                        <span className="truncate">Klíč aktivní: <strong className="font-mono text-zinc-350">{storedApiKeyMasked}</strong></span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-rose-500/5 border border-rose-500/10 p-2.5 rounded-xl text-[10px] text-rose-450">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                        <span>Klíč není uložen v DB</span>
                      </div>
                    )}

                    <p className="text-[10px] text-zinc-550 leading-relaxed text-left">
                      První zadaný klíč se bezpečně uloží do databáze, odkud jej bezplatně čerpají všichni uživatelé.
                    </p>

                    <div className="flex gap-2 pt-1">
                      <input
                        type="password"
                        placeholder="Zadej AIzaSy..."
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        className="flex-1 bg-black/40 border border-white/[8%] focus:border-[#4f5ff7]/40 focus:outline-none rounded-lg text-xs px-2.5 py-1.5 font-mono text-zinc-300 placeholder-zinc-700 truncate min-w-0"
                      />
                      <button
                        onClick={handleSaveApiKey}
                        disabled={isStoringKey || !geminiApiKey.trim()}
                        className="bg-[#4f5ff7]/15 hover:bg-[#4f5ff7]/25 border border-[#4f5ff7]/30 hover:border-[#4f5ff7]/65 text-[#7f8ff7] hover:text-white disabled:opacity-30 disabled:pointer-events-none rounded-lg text-[10px] font-bold uppercase tracking-wider px-3.5 transition-all cursor-pointer whitespace-nowrap flex items-center justify-center min-h-[30px]"
                      >
                        {isStoringKey ? "Ukládám..." : "Uložit"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Pref 3: Account detail and Logout */}
                <div className="bg-[#0b0d1a] border border-white/[5%] rounded-[24px] p-5 shadow-xl flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-black tracking-widest text-zinc-250 uppercase flex items-center gap-2 border-b border-white/[4%] pb-3 mb-4">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <span>Uživatelský Účet</span>
                    </h3>
                    <div className="text-left space-y-1">
                      <div className="text-[10px] font-mono tracking-wider text-zinc-500 uppercase">Status</div>
                      <div className="text-xs font-bold text-zinc-200 truncate">{user?.displayName || "Anonymní host"}</div>
                      <div className="text-[9px] font-mono text-[#4f5ff7] truncate">{user?.email || "host@shate.ai"}</div>
                    </div>
                  </div>

                  <div className="border-t border-white/[4%] mt-5 pt-4">
                    <button
                      onClick={() => {
                        setShowSettings(false);
                        handleSignOut();
                      }}
                      className="w-full h-9 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/40 text-rose-400 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Odhlásit se</span>
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Permission Error Modal */}
      <AnimatePresence>
        {permissionError && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/85 backdrop-blur-md z-[60] flex items-center justify-center p-4 text-center select-none"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#111322] border border-rose-500/25 rounded-[24px] w-full max-w-sm p-6 shadow-2xl relative"
            >
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                  <AlertCircle className="w-6 h-6" />
                </div>
                
                <h3 className="text-sm font-black tracking-wider text-rose-300 uppercase mt-2">
                  Chyba oprávnění
                </h3>
                
                <p className="text-xs text-zinc-350 leading-relaxed mt-1 text-left bg-zinc-950/40 p-3 rounded-xl border border-white/[5%] whitespace-pre-line select-text">
                  {permissionError.message}
                </p>

                <div className="flex flex-col gap-2 w-full pt-4">
                  <button
                    onClick={() => {
                      setPermissionError(null);
                      startSession();
                    }}
                    className="w-full h-10 bg-indigo-600 hover:bg-[#5f6ff7] text-white text-xs font-bold uppercase rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    Zkusit znovu
                  </button>

                  <button
                    onClick={() => setPermissionError(null)}
                    className="w-full h-10 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[5%] text-zinc-400 hover:text-white text-xs font-bold uppercase rounded-xl transition-all cursor-pointer"
                  >
                    Zavřít
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {confirmDialog?.isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm z-[90] flex items-center justify-center p-4 text-center select-none"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#111322] border border-white/10 rounded-[24px] w-full max-w-sm p-6 shadow-2xl relative"
            >
              <div className="flex flex-col items-center gap-3">
                <h3 className="text-sm font-black tracking-wider text-white uppercase mt-2">
                  {confirmDialog.title}
                </h3>
                
                <p className="text-xs text-zinc-300 leading-relaxed mt-1 text-center whitespace-pre-line select-text">
                  {confirmDialog.message}
                </p>

                <div className="flex gap-2 w-full pt-4">
                  <button
                    onClick={() => {
                      setConfirmDialog(null);
                    }}
                    className="w-full h-10 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[5%] text-zinc-400 hover:text-white text-xs font-bold uppercase rounded-xl transition-all cursor-pointer"
                  >
                    Zrušit
                  </button>
                  <button
                    onClick={() => {
                      confirmDialog.onConfirm();
                      setConfirmDialog(null);
                    }}
                    className="w-full h-10 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold uppercase rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    Smazat
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {alertDialog?.isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm z-[90] flex items-center justify-center p-4 text-center select-none"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#111322] border border-white/10 rounded-[24px] w-full max-w-sm p-6 shadow-2xl relative"
            >
              <div className="flex flex-col items-center gap-3">
                <h3 className="text-sm font-black tracking-wider text-white uppercase mt-2">
                  {alertDialog.title}
                </h3>
                
                <p className="text-xs text-zinc-300 leading-relaxed mt-1 text-center whitespace-pre-line select-text">
                  {alertDialog.message}
                </p>

                <div className="flex w-full pt-4">
                  <button
                    onClick={() => {
                      setAlertDialog(null);
                    }}
                    className="w-full h-10 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase rounded-xl transition-all cursor-pointer"
                  >
                    Rozumím
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes custom-wave-bounce {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1.0); }
        }
        .animate-wave-speed-1 {
          animation: custom-wave-bounce 0.8s infinite ease-in-out;
          transform-origin: bottom;
        }
        .animate-wave-speed-2 {
          animation: custom-wave-bounce 1.1s infinite cubic-bezier(0.25, 0.8, 0.25, 1);
          transform-origin: bottom;
          animation-delay: 150ms;
        }
        .animate-wave-speed-3 {
          animation: custom-wave-bounce 0.9s infinite ease-in-out;
          transform-origin: bottom;
          animation-delay: 300ms;
        }
        .animate-wave-speed-4 {
          animation: custom-wave-bounce 1.3s infinite cubic-bezier(0.25, 1, 0.5, 1);
          transform-origin: bottom;
          animation-delay: 50ms;
        }
        .animate-wave-speed-5 {
          animation: custom-wave-bounce 0.7s infinite ease-in-out;
          transform-origin: bottom;
          animation-delay: 200ms;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 9px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.12);
        }
      `}} />
    </div>
  );
}


import React from "react";
import { Smartphone, PhoneOff, History, Sparkles, ChevronRight, Zap } from "lucide-react";

interface RightChatColumnProps {
  chatHistory: Array<{ id: string; userText?: string; assistantText?: string; timestamp: Date }>;
  isConnected: boolean;
  isAiSpeaking: boolean;
  status: string;
  userTranscript: string;
  assistantTranscript: string;
  textMessage: string;
  setTextMessage: (text: string) => void;
  isSubmittingText: boolean;
  isInputFocused: boolean;
  setIsInputFocused: (focused: boolean) => void;
  onSubmitText: (e?: any) => void;
  onToggleVoice: () => void;
  onOpenHistory: () => void;
  photoManagerSlot: React.ReactNode;
}

export default function RightChatColumn({
  chatHistory,
  isConnected,
  isAiSpeaking,
  status,
  userTranscript,
  assistantTranscript,
  textMessage,
  setTextMessage,
  isSubmittingText,
  isInputFocused,
  setIsInputFocused,
  onSubmitText,
  onToggleVoice,
  onOpenHistory,
  photoManagerSlot
}: RightChatColumnProps) {
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory, userTranscript, assistantTranscript]);

  return (
    <div className="w-80 flex-shrink-0 bg-[#0a0c16] border-l border-white/[5%] flex flex-col h-full p-4 relative justify-between overflow-hidden">
      
      {/* Dynamic connection header section with status dot */}
      <div className="flex justify-between items-center pb-3 border-b border-white/[5%] shrink-0 select-none">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-indigo-400 font-bold font-mono">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${
            isConnected ? "bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" : "bg-zinc-600"
          }`} />
          <span>Shate AI {isConnected ? "Aktivní" : "Připravena"}</span>
        </div>
        
        <span className="text-[9px] text-zinc-500 font-mono tracking-widest max-w-[120px] truncate" title={status}>
          {status}
        </span>
      </div>

      {/* Modern voice micro waveform equalizer */}
      <div className="my-4 py-4 px-3 bg-[#111322] border border-white/[3%] rounded-2xl flex flex-col items-center justify-center select-none shrink-0 relative overflow-hidden group">
        <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-indigo-500/10 to-transparent" />
        
        {/* Decorative lightning background orb */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/2 to-sky-500/2 blur-lg pointer-events-none" />

        {isConnected && isAiSpeaking ? (
          <div className="flex items-end justify-center gap-1.5 h-6 select-none my-1">
            <span className="w-1 bg-[#4f5ff7] rounded-full animate-wave-speed-1" style={{ height: '55%' }} />
            <span className="w-1 bg-sky-400 rounded-full animate-wave-speed-2" style={{ height: '95%' }} />
            <span className="w-1 bg-[#4f5ff7] rounded-full animate-wave-speed-3" style={{ height: '35%' }} />
            <span className="w-1 bg-indigo-400 rounded-full animate-wave-speed-4" style={{ height: '80%' }} />
            <span className="w-1 bg-sky-400 rounded-full animate-wave-speed-5" style={{ height: '45%' }} />
            <span className="w-1 bg-[#4f5ff7] rounded-full animate-wave-speed-3" style={{ height: '60%' }} />
          </div>
        ) : isConnected ? (
          <div className="flex items-end justify-center gap-1.1 h-6 select-none my-1 opacity-50">
            <span className="w-1 h-3 bg-zinc-600 rounded-full animate-pulse" />
            <span className="w-1 h-2 bg-zinc-750 rounded-full" />
            <span className="w-1 h-4 bg-zinc-650 rounded-full animate-pulse" />
            <span className="w-1 h-1.5 bg-zinc-750 rounded-full" />
            <span className="w-1 h-3 bg-zinc-600 rounded-full" />
          </div>
        ) : (
          <div className="w-7 h-7 bg-white/[0.03] rounded-full border border-white/[4%] flex items-center justify-center my-0.5">
            <Zap className="w-3.5 h-3.5 text-zinc-600 fill-transparent" />
          </div>
        )}

        <div className="text-[8.5px] font-mono tracking-widest text-zinc-500 uppercase mt-2 select-none">
          {isConnected && isAiSpeaking 
            ? "ANALYZUJI OBSAH LEKCE..." 
            : isConnected 
            ? "HLASOVÉ SPOJENÍ AKTIVNÍ" 
            : "SHATE ROZHOVOR"
          }
        </div>
      </div>

      {/* Conversation speech dialogue bubbles container */}
      <div className="flex-1 flex flex-col justify-end overflow-hidden mb-4 min-h-0 select-text">
        <div className="space-y-3 max-h-full overflow-y-auto custom-scrollbar flex flex-col pr-1 pointer-events-auto">
          {chatHistory.length === 0 && !userTranscript && !assistantTranscript && (
            <div className="text-center py-6 px-4 select-none my-auto">
              <p className="text-[11px] text-zinc-600 max-w-[200px] mx-auto leading-relaxed font-medium">
                {isConnected 
                  ? "Mluvte se mnou přes mikrofon, poslouchám..." 
                  : "Zde uvidíš náš průběžný rozhovor. Začni psaním vespod nebo zapni mikrofon."
                }
              </p>
            </div>
          )}

          {chatHistory.map((msg) => (
            <React.Fragment key={msg.id}>
              {msg.userText && (
                <div className="flex justify-end w-full animate-fade-in text-right">
                  <div className="bg-[#4f5ff7] text-white text-[11px] py-2 px-3 rounded-[15px] rounded-tr-none shadow-sm shadow-[#4f5ff7]/10 max-w-[90%] font-medium select-text leading-relaxed text-left">
                    {msg.userText}
                  </div>
                </div>
              )}
              {msg.assistantText && (
                <div className="flex justify-start w-full animate-fade-in text-left">
                  <div className="bg-[#191b2b] border border-white/[4%] text-zinc-100 text-[11px] py-2.5 px-3 rounded-[15px] rounded-tl-none shadow-md max-w-[90%] leading-relaxed select-text">
                    <span className="text-[8px] font-mono tracking-wider text-[#4f5ff7] block mb-0.5 uppercase font-bold">Shate AI</span>
                    {msg.assistantText}
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}

          {userTranscript && (
            <div className="flex justify-end w-full animate-fade-in text-right">
              <div className="bg-[#4f5ff7]/70 text-white text-[11px] py-2 px-3 rounded-[15px] rounded-tr-none shadow-sm max-w-[90%] font-medium select-text leading-relaxed text-left animate-pulse">
                {userTranscript}
              </div>
            </div>
          )}

          {assistantTranscript && (
            <div className="flex justify-start w-full animate-fade-in text-left">
              <div className="bg-[#191b2b]/80 border border-white/[4%] text-zinc-200 text-[11px] py-2.5 px-3 rounded-[15px] rounded-tl-none shadow-md max-w-[90%] leading-relaxed select-text">
                <span className="text-[8px] font-mono tracking-wider text-[#4f5ff7] block mb-0.5 uppercase font-bold animate-pulse">Shate AI (mluví)</span>
                {assistantTranscript}
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Chat controls and inputs completely inline */}
      <div className="pt-3 border-t border-white/[5%] flex flex-col gap-2 shrink-0 select-none bg-transparent">
        <div className="flex items-center gap-2">
          {/* History Icon Trigger */}
          <button
            onClick={onOpenHistory}
            className="w-10 h-10 flex items-center justify-center bg-white/[0.03] hover:bg-white/[0.07] border border-white/[5%] text-zinc-400 hover:text-white rounded-xl transition-all duration-200 cursor-pointer flex-shrink-0"
            title="Historie"
          >
            <History className="w-4 h-4" />
          </button>

          {/* Slipped in Photo skener button component inside props */}
          {photoManagerSlot}

          {/* Symmetrical Inline Text Form */}
          <form
            onSubmit={onSubmitText}
            className={`relative flex items-center bg-[#131523] border rounded-xl transition-all duration-300 h-10 grow min-w-0 ${
              isInputFocused ? "border-[#4f5ff7]/60 ring-1 ring-indigo-505/20" : "border-white/[4%]"
            }`}
          >
            <input
              type="text"
              placeholder="Zeptej se na cokoliv..."
              value={textMessage}
              onChange={(e) => setTextMessage(e.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              disabled={isSubmittingText}
              className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none pl-3.5 pr-8 py-2 rounded-xl leading-none"
            />
            <button
              type="submit"
              disabled={!textMessage.trim() || isSubmittingText}
              className="absolute right-1.5 p-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 transition-all duration-200 disabled:opacity-0 cursor-pointer flex items-center justify-center"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </form>

          {/* Microphone Button */}
          <button
            onClick={onToggleVoice}
            className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-250 cursor-pointer shrink-0 ${
              isConnected 
                ? "bg-rose-500/20 border border-rose-500/50 text-rose-300 shadow-[0_0_8px_rgba(239,68,68,0.25)]" 
                : "bg-white/[0.03] hover:bg-white/[0.07] border border-white/[5%] text-zinc-400 hover:text-white"
            }`}
            title={isConnected ? "Vypnout mikrofon" : "Zapnout mikrofon"}
          >
            {isConnected ? (
              <PhoneOff className="w-4 h-4 text-rose-400 animate-pulse" />
            ) : (
              <Smartphone className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Action helper label row */}
        <div className="flex justify-between items-center text-[8.5px] text-zinc-600 px-1 font-semibold select-none">
          <span className="uppercase tracking-wider">PŘIDAT SOUBOR / SKENER</span>
          <span className="uppercase tracking-wider font-mono">SPACE MLUVIT</span>
        </div>
      </div>

    </div>
  );
}

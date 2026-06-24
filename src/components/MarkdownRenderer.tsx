import React from "react";
import { CheckSquare, Square } from "lucide-react";

interface MarkdownRendererProps {
  text: string;
  assistantTranscript?: string;
  onToggleTask?: (lineIndex: number) => void;
}

interface InteractiveCheckboxProps {
  key?: React.Key;
  uniqueKey: string;
  initiallyChecked: boolean;
  text: string;
  renderSentences: (rawText: string) => React.ReactNode;
}

function InteractiveCheckbox({ uniqueKey, initiallyChecked, text, renderSentences }: InteractiveCheckboxProps) {
  const [checked, setChecked] = React.useState(() => {
    try {
      const saved = localStorage.getItem(uniqueKey);
      if (saved !== null) {
        return saved === "true";
      }
    } catch (e) {
      console.warn("localStorage is not available", e);
    }
    return initiallyChecked;
  });

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !checked;
    setChecked(next);
    try {
      localStorage.setItem(uniqueKey, String(next));
    } catch (err) {
      console.warn("localStorage is not available", err);
    }
  };

  return (
    <div 
      onClick={toggle}
      className={`flex items-start gap-3 p-2.5 rounded-xl border transition-all duration-200 cursor-pointer select-none group w-full text-left ${
        checked 
          ? "bg-emerald-950/10 border-emerald-500/20 hover:bg-emerald-950/15 hover:border-emerald-500/30" 
          : "bg-white/[0.01] border-white/[3%] hover:bg-indigo-950/15 hover:border-[#4f5ff7]/15"
      }`}
    >
      <span className="mt-0.5 flex-shrink-0 transition-all duration-150 scale-100 group-hover:scale-105 active:scale-95">
        {checked ? (
          <div className="w-4 h-4 rounded-md bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shadow-[0_0_8px_rgba(52,211,153,0.15)]">
            <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
          </div>
        ) : (
          <div className="w-4 h-4 rounded-md border border-white/[15%] group-hover:border-[#4f5ff7]/40 flex items-center justify-center bg-white/[0.01]">
            <Square className="w-3.5 h-3.5 text-transparent" />
          </div>
        )}
      </span>
      <span className={`text-[11.5px] leading-snug font-medium transition-all duration-200 ${checked ? "line-through text-zinc-500 italic" : "text-zinc-200"}`}>
        {renderSentences(text)}
      </span>
    </div>
  );
}

// Cleans LaTeX math formulas and standardizes spacing around operators
function cleanMathAndSpecialChars(text: string): string {
  if (!text) return "";
  
  let result = text;
  
  // Core mathematical LaTeX operators replacements
  result = result.replace(/\\neg\s*/g, "¬");
  result = result.replace(/\\land\s*/g, " ∧ ");
  result = result.replace(/\\lor\s*/g, " ∨ ");
  result = result.replace(/\\rightarrow\s*/g, " → ");
  result = result.replace(/\\Rightarrow\s*/g, " ⇒ ");
  result = result.replace(/\\Leftarrow\s*/g, " ⇐ ");
  result = result.replace(/\\to\s*/g, " → ");
  result = result.replace(/\\leftrightarrow\s*/g, " ↔ ");
  result = result.replace(/\\Leftrightarrow\s*/g, " ⇔ ");
  result = result.replace(/\\times\s*/g, " × ");
  result = result.replace(/\\cdot\s*/g, " · ");
  result = result.replace(/\\in\s*/g, " ∈ ");
  result = result.replace(/\\notin\s*/g, " ∉ ");
  result = result.replace(/\\subset\s*/g, " ⊂ ");
  result = result.replace(/\\supset\s*/g, " ⊃ ");
  result = result.replace(/\\cap\s*/g, " ∩ ");
  result = result.replace(/\\cup\s*/g, " ∪ ");
  result = result.replace(/\\emptyset\s*/g, " ∅ ");
  result = result.replace(/\\setminus\s*/g, " \\ ");
  result = result.replace(/\\forall\s*/g, " ∀ ");
  result = result.replace(/\\exists\s*/g, " ∃ ");
  result = result.replace(/\\approx\s*/g, " ≈ ");
  result = result.replace(/\\neq\s*/g, " ≠ ");
  result = result.replace(/\\le\s*/g, " ≤ ");
  result = result.replace(/\\ge\s*/g, " ≥ ");
  result = result.replace(/\\alpha\s*/g, "α");
  result = result.replace(/\\beta\s*/g, "β");
  result = result.replace(/\\gamma\s*/g, "γ");
  result = result.replace(/\\pi\s*/g, "π");
  result = result.replace(/\\infty\s*/g, " ∞ ");

  // Remove standard math dollar sign wrappers ($A$ -> A)
  result = result.replace(/\$([^\$]+)\$/g, "$1");

  // Clean raw LaTeX custom bracket styling (e.g. \{ \} )
  result = result.replace(/\\{/g, "{").replace(/\\}/g, "}");
  
  // Clean double multiple spaces
  result = result.replace(/\s+/g, " ");

  return result.trim();
}

// Helpers for checking similarity or matching of live speaking
function isTextHighlighted(cardText: string, assistantTranscript?: string): boolean {
  if (!assistantTranscript || !cardText) return false;
  
  const clean = (t: string) => t.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?\n]/g, "")
    .replace(/\s+/g, " ")
    .trim();
    
  const cleanCard = clean(cardText);
  const cleanTranscript = clean(assistantTranscript);
  
  if (cleanCard.length < 5) return false;
  if (cleanTranscript.includes(cleanCard)) return true;
  
  // Word-by-word windows for slightly different phrasings
  if (cleanCard.length > 20) {
    const words = cleanCard.split(" ");
    if (words.length > 4) {
      for (let i = 0; i < words.length - 3; i++) {
        const windowStr = words.slice(i, i + 4).join(" ");
        if (cleanTranscript.includes(windowStr)) {
          return true;
        }
      }
    }
  }
  
  return false;
}

export default function MarkdownRenderer({ text, assistantTranscript, onToggleTask }: MarkdownRendererProps) {
  if (!text) return null;

  // Fully parses styling annotations (**bold**, *italic-emphasis*)
  const renderStyledText = (rawLineText: string) => {
    // 1. Clean math formulas first
    const cleaned = cleanMathAndSpecialChars(rawLineText);

    // 2. Parse bold blocks (**text**)
    const boldSplit = cleaned.split(/\*\*(.*?)\*\*/g);
    
    return boldSplit.map((part, i) => {
      if (i % 2 === 1) {
        return (
          <strong key={`b-${i}`} className="font-extrabold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-md shadow-[0_0_8px_rgba(245,158,11,0.15)] mx-0.5 inline-block">
            {part}
          </strong>
        );
      }
      
      // 3. Inside non-bold parts, query and handle single asterisks (*emphasis*)
      const italicSplit = part.split(/\*(.*?)\*/g);
      return italicSplit.map((subPart, j) => {
        if (j % 2 === 1) {
          return (
            <strong key={`i-${i}-${j}`} className="font-bold text-white bg-indigo-600/10 px-1 py-0.5 rounded border border-indigo-505/10 mx-0.5">
              {subPart}
            </strong>
          );
        }
        return subPart;
      });
    });
  };

  // Helper that renders text with sentence-by-sentence highlight matches in blue
  const renderSentences = (rawText: string) => {
    if (!assistantTranscript) {
      return renderStyledText(rawText);
    }
    
    // Split on sentence boundary characters followed by space
    const sentences = rawText.split(/(?<=[.!?])\s+/);
    
    return sentences.map((sentence, sIdx) => {
      if (!sentence.trim()) return null;
      const belongs = isTextHighlighted(sentence, assistantTranscript);
      const nodes = renderStyledText(sentence);
      
      if (belongs) {
        return (
          <span 
            key={sIdx} 
            className="bg-blue-600/15 text-blue-200 border-b border-blue-400 px-1 py-0.5 rounded transition-all duration-300 shadow-[0_0_8px_rgba(59,130,246,0.15)] inline"
          >
            {nodes}{" "}
          </span>
        );
      }
      
      return (
        <span key={sIdx} className="transition-all duration-300 inline">
          {nodes}{" "}
        </span>
      );
    });
  };

  const lines = text.split("\n");

  return (
    <div className="space-y-3.5 font-sans select-text pb-2">
      {lines.map((line, idx) => {
        const cleanLine = line.trim();
        
        // Empty lines
        if (!cleanLine) {
          return null;
        }

        // Headers
        if (cleanLine.startsWith("###") || cleanLine.startsWith("##") || cleanLine.startsWith("#")) {
          const depth = cleanLine.match(/^#+/)?.[0].length || 1;
          const headerText = cleanLine.replace(/^#+\s*/, "");
          const headingNode = renderSentences(headerText);
          return (
            <h4 
              key={idx} 
              className={`font-sans font-bold tracking-tight text-indigo-400 ${
                depth === 1 ? "text-sm mt-5 mb-2.5 pb-2 border-b border-white/[6%]" : "text-xs mt-4 mb-2"
              }`}
            >
              {headingNode}
            </h4>
          );
        }

        // Bullet list item
        const isBullet = cleanLine.startsWith("- ") || cleanLine.startsWith("* ");
        if (isBullet) {
          let content = cleanLine.substring(2).trim();
          const isCompleted = content.startsWith("[x]") || content.startsWith("[X]") || content.includes("~~") || content.toLowerCase().includes("(hotovo)") || content.toLowerCase().includes("(splněno)");
          
          // Strip any standard checkbox syntax
          if (content.startsWith("[ ]") || content.startsWith("[x]") || content.startsWith("[X]")) {
            content = content.substring(3).trim();
          }
          if (content.startsWith("~~") && content.endsWith("~~")) {
            content = content.substring(2, content.length - 2).trim();
          }
          // Clean the suffix tags if needed
          content = content.replace(/\(hotovo\)/gi, "").replace(/\(splněno\)/gi, "").trim();

          if (isCompleted) {
            return (
              <div 
                key={idx} 
                onClick={() => onToggleTask?.(idx)}
                className={`flex items-start gap-3 p-2.5 bg-emerald-950/5 border border-emerald-500/10 rounded-xl text-zinc-400 opacity-65 line-through decoration-zinc-500/50 transition-all duration-250 my-1.5 select-none hover:bg-emerald-950/10 ${
                  onToggleTask ? "cursor-pointer hover:opacity-85" : ""
                }`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  <div className="w-4 h-4 rounded bg-emerald-500/10 border border-emerald-400/30 flex items-center justify-center shadow-[0_0_8px_rgba(52,211,153,0.1)]">
                    <span className="text-[10px] font-black leading-none text-emerald-400">✓</span>
                  </div>
                </div>
                <div className="flex-1 text-[11.5px] leading-relaxed font-semibold tracking-wide text-zinc-450">
                  {renderSentences(content)}
                </div>
              </div>
            );
          }

          return (
            <div 
              key={idx} 
              className="flex items-start justify-between gap-3 p-2.5 bg-indigo-950/10 border border-[#4f5ff7]/10 rounded-xl text-zinc-200 transition-all duration-200 hover:bg-indigo-950/20 hover:border-[#4f5ff7]/25 my-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.15)] group"
            >
              <div
                onClick={() => onToggleTask?.(idx)}
                className={`flex items-start gap-3 flex-1 ${onToggleTask ? "cursor-pointer" : ""}`}
              >
                <div className="mt-1 flex-shrink-0">
                  <div className="w-4 h-4 rounded border border-white/[15%] flex items-center justify-center bg-white/[0.01] group-hover:border-[#4f5ff7]/40" />
                </div>
                <div className="flex-1 text-[11.5px] leading-relaxed font-semibold tracking-wide text-zinc-150 drop-shadow-[0_0_4px_rgba(165,180,252,0.15)]">
                  {renderSentences(content)}
                </div>
              </div>
            </div>
          );
        }

        // Handle formula or code highlights in monospace if they start with backticks or contain math blocks
        if (cleanLine.startsWith("`") && cleanLine.endsWith("`")) {
          const codeText = cleanLine.replace(/`/g, "");
          return (
            <div key={idx} className="bg-[#151726] border border-indigo-505/10 rounded-xl p-3.5 my-3 relative overflow-hidden font-mono text-[11px] text-indigo-400">
              <div className="absolute right-2 top-2 text-[8px] tracking-wider uppercase text-zinc-650">Vzorec</div>
              <code>{cleanMathAndSpecialChars(codeText)}</code>
            </div>
          );
        }

        // Definition blocks or special key facts in study cards (contains colons)
        if (cleanLine.toUpperCase().startsWith("DEFINICE:") || cleanLine.toUpperCase().startsWith("ZÁVĚR:") || cleanLine.toUpperCase().startsWith("DŮLEŽITÉ:")) {
          return (
            <div key={idx} className="bg-[#161a2f]/45 border border-indigo-600/10 rounded-xl p-4 my-3 text-xs md:text-sm text-zinc-300 leading-relaxed font-normal">
              {renderSentences(cleanLine)}
            </div>
          );
        }

        // Standard Paragraphs
        return (
          <p key={idx} className="text-xs md:text-sm text-zinc-300 leading-relaxed font-normal mb-2 text-justify">
            {renderSentences(cleanLine)}
          </p>
        );
      }).filter(Boolean)}
    </div>
  );
}

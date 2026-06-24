import { Clock, Calendar, Moon, Sun, Dumbbell, Coffee, Brain, Sparkles, HelpCircle, Heart, PlusCircle } from "lucide-react";

interface SidebarProps {
  savedCards: Array<{ subject?: string }>;
  selectedSubject: string | null;
  setSelectedSubject: (subject: string | null) => void;
}

export const getSubjectIcon = (subjectName: string) => {
  const norm = (subjectName || "").toLowerCase().trim();
  if (norm.includes("den") || norm.includes("plán") || norm.includes("daily") || norm.includes("agenda")) 
    return <Calendar className="w-4 h-4 text-sky-400" />;
  if (norm.includes("ráno") || norm.includes("ranní") || norm.includes("morning") || norm.includes("vstáv")) 
    return <Sun className="w-4 h-4 text-blue-400" />;
  if (norm.includes("večer") || norm.includes("noc") || norm.includes("evening") || norm.includes("spán")) 
    return <Moon className="w-4 h-4 text-amber-400" />;
  if (norm.includes("cvič") || norm.includes("sport") || norm.includes("posilov") || norm.includes("workout") || norm.includes("zdraví")) 
    return <Dumbbell className="w-4 h-4 text-emerald-400" />;
  if (norm.includes("prác") || norm.includes("úkol") || norm.includes("work") || norm.includes("škola") || norm.includes("stud")) 
    return <Clock className="w-4 h-4 text-teal-400" />;
  if (norm.includes("káv") || norm.includes("jídlo") || norm.includes("snída") || norm.includes("oběd") || norm.includes("večeř")) 
    return <Coffee className="w-4 h-4 text-rose-400" />;
  if (norm.includes("koníč") || norm.includes("relax") || norm.includes("voln") || norm.includes("zábav")) 
    return <Heart className="w-4 h-4 text-pink-400" />;
  return <Sparkles className="w-4 h-4 text-cyan-400" />;
};

export default function Sidebar({ savedCards, selectedSubject, setSelectedSubject }: SidebarProps) {
  // Extract unique subjects from actual saved cards + default planning categories for empty state polish
  const defaultCategories = ["Denní plán", "Ranní rutina", "Večerní Routine", "Cvičení a zdraví"];
  const dbSubjects = savedCards.map(c => c.subject || "Denní plán").filter(Boolean);
  const uniqueSubjects = Array.from(new Set([...defaultCategories, ...dbSubjects])).filter(Boolean);

  return (
    <div className="w-60 flex-shrink-0 bg-[#0a0c16] border-r border-white/[5%] flex flex-col h-full text-zinc-300 select-none">
      {/* Brand space */}
      <div className="h-16 flex items-center px-6 border-b border-white/[5%]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-600/10 border border-indigo-505/20 rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-indigo-400" />
          </div>
          <span className="text-sm font-extrabold tracking-[0.2em] text-white uppercase">Shate Plánovač</span>
        </div>
      </div>

      {/* Main sidebar content */}
      <div className="flex-1 py-5 px-4 space-y-5 overflow-y-auto custom-scrollbar">
        <div>
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-1">
            Plánování & Rutiny
          </span>
          <span className="text-[8.5px] font-mono tracking-widest text-[#4f5ff7] block mb-4 uppercase">
            Tvůj osobní asistent
          </span>

          <div className="space-y-1">
            {/* Quick Link to Dashboard/Main Overview */}
            <button
              onClick={() => setSelectedSubject(null)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left text-xs font-semibold tracking-wide transition-all duration-200 group relative ${
                selectedSubject === null
                  ? "bg-[#181b2e] text-[#4f5ff7] border border-indigo-505/10"
                  : "text-zinc-400 hover:text-white hover:bg-[#111322]"
              }`}
            >
              {selectedSubject === null && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#4f5ff7] rounded-r-md" />
              )}
              <div className={`p-1 rounded-lg transition-colors shrink-0 ${
                selectedSubject === null ? "bg-indigo-605/10" : "bg-white/[0.02]"
              }`}>
                <Calendar className="w-4 h-4 text-sky-400" />
              </div>
              <span className="truncate">Dnešní přehled</span>
            </button>

            <div className="h-[1px] bg-white/[4%] my-2" />

            {uniqueSubjects.map((subName) => {
              const active = selectedSubject === subName;
              return (
                <button
                  key={subName}
                  onClick={() => setSelectedSubject(subName)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left text-xs font-semibold tracking-wide transition-all duration-200 group relative ${
                    active 
                      ? "bg-[#181b2e] text-[#4f5ff7] border border-indigo-505/10" 
                      : "text-zinc-400 hover:text-white hover:bg-[#111322]"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#4f5ff7] rounded-r-md" />
                  )}
                  <div className={`p-1 rounded-lg transition-colors shrink-0 ${
                    active ? "bg-indigo-605/10" : "bg-white/[0.02]"
                  }`}>
                    {getSubjectIcon(subName)}
                  </div>
                  <span className="truncate">{subName}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Sidebar footer */}
      <div className="p-4 border-t border-white/[5%] bg-white/[0.01]">
        <div className="flex items-center gap-2 px-3 py-2 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer text-xs font-medium">
          <HelpCircle className="w-4 h-4" />
          <span>Nápověda k Shate</span>
        </div>
      </div>
    </div>
  );
}

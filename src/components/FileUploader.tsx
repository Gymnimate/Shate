import React, { useRef } from "react";
import { Paperclip, Loader2 } from "lucide-react";

interface FileUploaderProps {
  onFileAttached: (file: {
    name: string;
    type: string;
    size: number;
    base64?: string;
    textContent?: string;
  } | null) => void;
  attachedFile: {
    name: string;
    type: string;
    size: number;
    base64?: string;
    textContent?: string;
  } | null;
  statusSetter: (msg: string) => void;
}

export default function FileUploader({ onFileAttached, attachedFile, statusSetter }: FileUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isReading, setIsReading] = React.useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsReading(true);
    statusSetter(`Čtu soubor ${file.name}...`);

    const isText = 
      file.type.startsWith("text/") || 
      /\.(txt|md|json|csv|js|ts|py|html|css|yaml|yml)$/i.test(file.name);

    const isImage = file.type.startsWith("image/");
    const isPDF = file.type === "application/pdf";

    const reader = new FileReader();

    if (isText) {
      reader.onload = (event) => {
        const text = event.target?.result as string;
        onFileAttached({
          name: file.name,
          type: file.type || "text/plain",
          size: file.size,
          textContent: text
        });
        statusSetter(`Textový soubor ${file.name} připojen`);
        setIsReading(false);
      };
      reader.onerror = () => {
        statusSetter(`Chyba při čtení souboru.`);
        setIsReading(false);
      };
      reader.readAsText(file);
    } else if (isImage || isPDF) {
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        onFileAttached({
          name: file.name,
          type: file.type,
          size: file.size,
          base64: base64
        });
        statusSetter(`Soubor ${file.name} připojen k analýze`);
        setIsReading(false);
      };
      reader.onerror = () => {
        statusSetter(`Chyba při čtení souboru.`);
        setIsReading(false);
      };
      reader.readAsDataURL(file);
    } else {
      // General fallback - try to read as text first if its small, otherwise read as data URL base64
      const isSmall = file.size < 100 * 1024; // < 100KB
      if (isSmall) {
        reader.onload = (event) => {
          const text = event.target?.result as string;
          onFileAttached({
            name: file.name,
            type: "text/plain",
            size: file.size,
            textContent: text
          });
          statusSetter(`Soubor ${file.name} připojen jako text`);
          setIsReading(false);
        };
        reader.onerror = () => {
          statusSetter(`Chyba při čtení souboru.`);
          setIsReading(false);
        };
        reader.readAsText(file);
      } else {
        reader.onload = (event) => {
          const base64 = event.target?.result as string;
          onFileAttached({
            name: file.name,
            type: file.type || "application/octet-stream",
            size: file.size,
            base64: base64
          });
          statusSetter(`Soubor ${file.name} připojen`);
          setIsReading(false);
        };
        reader.onerror = () => {
          statusSetter(`Chyba při čtení souboru.`);
          setIsReading(false);
        };
        reader.readAsDataURL(file);
      }
    }

    // Reset input
    e.target.value = "";
  };

  const triggerSelect = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*,application/pdf,text/*,.txt,.md,.json,.csv,.py,.js"
        className="hidden"
      />
      
      <button
        type="button"
        onClick={triggerSelect}
        disabled={isReading}
        className={`w-10 h-10 border hover:text-white rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer flex-shrink-0 relative ${
          attachedFile 
            ? "bg-[#4f5ff7]/20 border-[#4f5ff7]/40 text-[#4f5ff7] shadow-[0_0_10px_rgba(79,95,247,0.15)]" 
            : "bg-[#4f5ff7]/10 border-[#4f5ff7]/15 text-[#4f5ff7] hover:bg-[#4f5ff7]/15 hover:border-[#4f5ff7]/35"
        }`}
        title="Připojit soubor (PDF, Text, Obrázek)"
      >
        {isReading ? (
          <Loader2 className="w-4 h-4 animate-spin text-[#4f5ff7]" />
        ) : (
          <Paperclip className="w-4 h-4" />
        )}
        
        {attachedFile && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full border border-[#070913] animate-pulse" />
        )}
      </button>
    </>
  );
}

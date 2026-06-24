import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Camera, Image, X, RefreshCw, Focus } from "lucide-react";

interface PhotoManagerProps {
  onSendImage: (base64Data: string) => void;
  statusSetter: (msg: string) => void;
}

export default function PhotoManager({ onSendImage, statusSetter }: PhotoManagerProps) {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Stop camera tracks when component unmounts
  useEffect(() => {
    return () => {
      stopCameraOnly();
    };
  }, []);

  const startCamera = async (forceMode?: "user" | "environment") => {
    const activeMode = forceMode || facingMode;
    try {
      setCameraError(null);
      setIsCameraActive(true);

      // Stop any existing tracks before initializing
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      // Access camera feed
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: activeMode } },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Failed to start camera feed with ideal mode:", activeMode, err);
      // Fallback to any camera device
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (innerErr) {
        setCameraError("Nepodařilo se spustit fotoaparát. Ověřte oprávnění kamery.");
        statusSetter("Chyba přístupu ke kameře");
      }
    }
  };

  const stopCameraOnly = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const toggleFacingMode = () => {
    const nextMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextMode);
    if (isCameraActive) {
      startCamera(nextMode);
    }
  };

  const takeSnapshot = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Draw video frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        
        statusSetter("Fotka pořízena");
        onSendImage(dataUrl);
        closeAll();
      }
    }
  };

  const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCameraError(null);
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      statusSetter("Fotka vybrána z galerie");
      onSendImage(result);
      closeAll();
    };
    reader.readAsDataURL(file);
    // Reset file input value so same file can be chosen again if needed
    e.target.value = "";
  };

  const triggerGalleryUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const closeAll = () => {
    stopCameraOnly();
    setIsCameraActive(false);
    setCameraError(null);
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleGallerySelect}
        accept="image/*"
        className="hidden"
      />

      {/* Main photo trigger button in the typing footer bar */}
      <button
        onClick={() => {
          if (isCameraActive) {
            closeAll();
          } else {
            startCamera();
          }
        }}
        className="w-10 h-10 bg-[#4f5ff7]/10 border border-[#4f5ff7]/15 hover:border-[#4f5ff7]/35 text-[#4f5ff7] hover:text-white hover:bg-[#4f5ff7]/15 active:scale-95 rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer flex-shrink-0"
        title="Pořídit fotku"
      >
        <Camera className="w-4 h-4" />
      </button>

      {/* Embedded Camera Viewfinder (compact inside client-space bounding box, keeping footer visible below bottom-16) */}
      <AnimatePresence>
        {isCameraActive && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="absolute bottom-16 left-4 right-4 top-14 bg-[#070913]/98 border border-white/[8%] z-40 flex flex-col justify-between p-4 rounded-3xl"
          >
            <div className="flex flex-col h-full justify-between pb-2">
              {/* Header info */}
              <div className="flex items-center justify-between shrink-0 pt-1">
                <div className="flex items-center gap-1.5 pl-2">
                  <Focus className="w-4 h-4 text-[#4f5ff7] animate-pulse" />
                  <span className="text-[10px] font-mono tracking-wider text-zinc-300">FOŤÁK SHATE</span>
                </div>
                <button
                  type="button"
                  onClick={closeAll}
                  className="p-1 px-3 text-zinc-400 hover:text-white rounded-xl transition-all cursor-pointer border border-white/[5%] bg-white/[0.02] text-[10px] font-medium"
                >
                  Zavřít
                </button>
              </div>

              {/* Square Viewfinder */}
              <div className="flex-1 flex items-center justify-center py-2 min-h-0">
                <div className="relative aspect-square w-full max-w-[240px] rounded-[32px] bg-black overflow-hidden border border-[#4f5ff7]/25 shadow-[0_0_20px_rgba(79,95,247,0.12)]">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {/* Grid overlay */}
                  <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(79,95,247,0.03)_1px,transparent_1px),linear-gradient(to_right,rgba(79,95,247,0.03)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none mix-blend-overlay" />
                  
                  {/* Focus corners */}
                  <div className="absolute top-5 left-5 w-4 h-4 border-t-2 border-l-2 border-[#4f5ff7]/70 pointer-events-none" />
                  <div className="absolute top-5 right-5 w-4 h-4 border-t-2 border-r-2 border-[#4f5ff7]/70 pointer-events-none" />
                  <div className="absolute bottom-5 left-5 w-4 h-4 border-b-2 border-l-2 border-[#4f5ff7]/70 pointer-events-none" />
                  <div className="absolute bottom-5 right-5 w-4 h-4 border-b-2 border-r-2 border-[#4f5ff7]/70 pointer-events-none" />
                </div>
              </div>

              {/* Camera access error feedback */}
              {cameraError && (
                <div className="p-2 mb-2 bg-rose-950/20 border border-rose-500/20 rounded-xl text-center">
                  <p className="text-[10px] text-rose-450 leading-normal">{cameraError}</p>
                </div>
              )}

              {/* Controls row */}
              <div className="flex items-center justify-between px-8 py-1 shrink-0">
                <button
                  type="button"
                  onClick={triggerGalleryUpload}
                  className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[5%] text-zinc-400 hover:text-white flex items-center justify-center transition-all cursor-pointer active:scale-95"
                  title="Nahrát z galerie"
                >
                  <Image className="w-4 h-4 text-zinc-400" />
                </button>

                <button
                  type="button"
                  onClick={takeSnapshot}
                  className="w-14 h-14 rounded-full bg-[#4f5ff7] hover:bg-[#5a6bf8] flex items-center justify-center active:scale-90 transition-all cursor-pointer p-0.5 ring-4 ring-[#4f5ff7]/20 shadow-[0_0_15px_rgba(79,95,247,0.35)]"
                  title="Vyfotit"
                >
                  <div className="w-full h-full rounded-full border border-slate-950 bg-transparent" />
                </button>

                <button
                  type="button"
                  onClick={toggleFacingMode}
                  className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[5%] text-zinc-400 hover:text-white flex items-center justify-center transition-all cursor-pointer active:scale-95"
                  title="Otočit kameru"
                >
                  <RefreshCw className="w-4 h-4 text-zinc-400" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

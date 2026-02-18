import { useState, useRef } from "react";
import { Play, Pause, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMediaBubbleProps {
  mediaType: string;
  mediaUrl: string;
  caption?: string;
  isOutbound: boolean;
}

function AudioPlayer({ src, isOutbound }: { src: string; isOutbound: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setProgress(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
  };

  const handleEnded = () => setPlaying(false);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = ratio * duration;
  };

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        preload="metadata"
      />
      <button
        onClick={togglePlay}
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
          isOutbound ? "bg-[#4fc3f7]/20 text-[#0d7377]" : "bg-primary/10 text-primary"
        )}
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-0.5">
        <div
          className="h-1.5 rounded-full bg-black/10 cursor-pointer relative overflow-hidden"
          onClick={handleSeek}
        >
          <div
            className={cn("h-full rounded-full transition-all", isOutbound ? "bg-[#4fc3f7]" : "bg-primary")}
            style={{ width: duration ? `${(progress / duration) * 100}%` : "0%" }}
          />
        </div>
        <span className="text-[10px] opacity-60">
          {formatTime(playing ? progress : duration || 0)}
        </span>
      </div>
    </div>
  );
}

export function ChatMediaBubble({ mediaType, mediaUrl, caption, isOutbound }: ChatMediaBubbleProps) {
  if (mediaType === "audio") {
    return <AudioPlayer src={mediaUrl} isOutbound={isOutbound} />;
  }

  if (mediaType === "image") {
    return (
      <div className="space-y-1">
        <img
          src={mediaUrl}
          alt={caption || "Image"}
          className="rounded-md max-w-[280px] max-h-[300px] object-cover cursor-pointer"
          onClick={() => window.open(mediaUrl, "_blank")}
          loading="lazy"
        />
        {caption && <p className="whitespace-pre-wrap break-words text-[13.5px]">{caption}</p>}
      </div>
    );
  }

  if (mediaType === "video") {
    return (
      <div className="space-y-1">
        <video
          src={mediaUrl}
          controls
          className="rounded-md max-w-[280px] max-h-[300px]"
          preload="metadata"
        />
        {caption && <p className="whitespace-pre-wrap break-words text-[13.5px]">{caption}</p>}
      </div>
    );
  }

  // Document or unknown
  return (
    <a
      href={mediaUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2 p-2 rounded-md",
        isOutbound ? "bg-black/5" : "bg-muted/50"
      )}
    >
      <Download size={18} className="flex-shrink-0 opacity-60" />
      <span className="text-sm truncate">{caption || "Documento"}</span>
    </a>
  );
}

import React from 'react';
import { useMusic } from './MusicContext';
import { useThemeColors } from '../context/ThemeContext';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Disc,
  Volume2,
  VolumeX,
  X,
  ExternalLink,
  Repeat,
  Infinity as InfinityIcon
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function FloatingMusicWidget() {
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    stopMusic,
    nextTrack,
    prevTrack,
    isRepeating,
    toggleRepeat,
    volume,
    setVolume,
    currentTime,
    duration,
    seek,
    isLoadingAudio,
    currentLyricLine
  } = useMusic();
  const colors = useThemeColors();
  const navigate = useNavigate();
  const location = useLocation();

  if (!currentTrack) return null;

  // If already on the dedicated music page, don't obstruct full player
  const isMusicPage = location.pathname === '/music';
  if (isMusicPage) return null;

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs === 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <aside
      aria-label="Persistent Audio Player"
      className="fixed bottom-6 right-6 z-50 w-[calc(100vw-3rem)] sm:w-[440px] md:w-[480px] bg-zinc-950/95 backdrop-blur-xl border border-zinc-700/80 rounded-2xl p-4 shadow-2xl transition-all duration-300 ring-1 ring-white/10"
    >
      <div className="flex flex-col gap-3">
        {/* Top row: Track info, art, and actions */}
        <div className="flex items-center gap-3.5">
          {/* Album Art */}
          <div
            onClick={() => navigate('/music')}
            className="relative w-14 h-14 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-700/80 flex-shrink-0 cursor-pointer group flex items-center justify-center shadow-md"
            title="Open full music player"
          >
            {currentTrack.pic ? (
              <img
                src={currentTrack.pic}
                alt=""
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
                className={`w-full h-full object-cover transition-transform duration-500 ${isPlaying ? 'scale-105' : 'group-hover:scale-105'}`}
                referrerPolicy="no-referrer"
              />
            ) : null}
            <Disc size={28} className={`text-zinc-500 ${isPlaying ? 'animate-spin' : ''} ${currentTrack.pic ? '-z-10 absolute' : ''}`} />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <ExternalLink size={16} className="text-white drop-shadow" />
            </div>
          </div>

          {/* Track Name & Artist */}
          <div
            onClick={() => navigate('/music')}
            className="flex-1 min-w-0 cursor-pointer"
            title="Open full music player"
          >
            <p className="text-sm font-bold text-white truncate hover:underline">
              {currentTrack.name}
            </p>
            <p className="text-xs text-zinc-400 truncate mt-0.5">{currentTrack.artist}</p>
            {currentLyricLine && (
              <p className="text-[11px] text-emerald-400 truncate font-mono mt-0.5">
                {currentLyricLine}
              </p>
            )}
          </div>

          {/* Player controls */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={prevTrack}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
              title="Previous Track"
            >
              <SkipBack size={18} />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              disabled={isLoadingAudio}
              className={`p-2.5 rounded-xl text-white transition-all transform active:scale-95 cursor-pointer shadow-lg ${colors.primaryBg}`}
              style={{ backgroundColor: colors.hexPrimary }}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isLoadingAudio ? (
                <div className="w-[18px] h-[18px] border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : isPlaying ? (
                <Pause size={18} />
              ) : (
                <Play size={18} className="ml-0.5" />
              )}
            </button>
            <button
              type="button"
              onClick={nextTrack}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
              title="Next Track"
            >
              <SkipForward size={18} />
            </button>

            {/* Repeat Button */}
            <button
              type="button"
              onClick={toggleRepeat}
              className={`p-2 rounded-xl transition-colors cursor-pointer ${
                isRepeating
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 ring-1 ring-emerald-500/30'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
              title={isRepeating ? 'Repeat: Infinite Loop ON' : 'Repeat: OFF'}
            >
              {isRepeating ? <InfinityIcon size={20} className="text-emerald-400" /> : <Repeat size={18} />}
            </button>

            {/* Close & Stop Button */}
            <button
              type="button"
              onClick={stopMusic}
              className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors cursor-pointer ml-0.5"
              title="Close & Stop Music"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Bottom row: Scrub bar, time, and volume */}
        <div className="flex items-center gap-3 pt-1 border-t border-zinc-800/80">
          <span className="text-[11px] font-mono text-zinc-400 w-9 text-right flex-shrink-0">
            {formatTime(currentTime)}
          </span>

          {/* Progress Slider */}
          <div className="flex-1 relative flex items-center">
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={(e) => seek(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-400 transition-all hover:h-2"
              title="Seek"
            />
          </div>

          <span className="text-[11px] font-mono text-zinc-500 w-9 flex-shrink-0">
            {formatTime(duration)}
          </span>

          {/* Volume Control */}
          <div className="hidden sm:flex items-center gap-1.5 pl-2 border-l border-zinc-800">
            <button
              type="button"
              onClick={() => setVolume(volume === 0 ? 0.7 : 0)}
              className="text-zinc-400 hover:text-white"
              title={volume === 0 ? 'Unmute' : 'Mute'}
            >
              {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-20 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
              title="Volume"
            />
          </div>
        </div>
      </div>
    </aside>
  );
}

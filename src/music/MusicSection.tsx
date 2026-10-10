import React, { useState, useEffect } from 'react';
import { useMusic, MusicTrack } from './MusicContext';
import { useThemeColors } from '../context/ThemeContext';
import {
  fetchClientDeezer,
  fetchClientOctave,
  fetchClientYouTube,
  fetchClientSoundCloud
} from './clientMusicFallback';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Search,
  Disc,
  Loader2,
  X,
  Music2,
  Repeat,
  BadgeCheck,
  Radio,
  Zap,
  Headphones
} from 'lucide-react';

export const SEARCH_PLACEHOLDER_TEXT = "Search any song, artist, album, or genre";
export const NO_TRACK_ARTIST_PLACEHOLDER = "Select or search any track below";

const isPlatformName = (str?: string) => {
  if (!str) return false;
  const s = str.trim().toLowerCase();
  return ['soundcloud', 'youtube', 'youtube music', 'octave', 'deezer', 'yt'].includes(s);
};

export type MusicSource = 'octave' | 'youtube' | 'soundcloud' | 'deezer';

interface SourceOption {
  id: MusicSource;
  name: string;
  colorClass: string;
  activeBg: string;
  icon: React.ReactNode;
}

const SOURCES: SourceOption[] = [
  {
    id: 'octave',
    name: 'Octave',
    colorClass: 'text-purple-400',
    activeBg: 'bg-purple-500/20 border-purple-500/40 text-purple-300 shadow-purple-500/10',
    icon: <Zap size={14} className="text-purple-400" />
  },
  {
    id: 'youtube',
    name: 'YouTube Music',
    colorClass: 'text-red-400',
    activeBg: 'bg-red-500/20 border-red-500/40 text-red-300 shadow-red-500/10',
    icon: <Radio size={14} className="text-red-400" />
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    colorClass: 'text-orange-400',
    activeBg: 'bg-orange-500/20 border-orange-500/40 text-orange-300 shadow-orange-500/10',
    icon: <Disc size={14} className="text-orange-400" />
  },
  {
    id: 'deezer',
    name: 'Deezer',
    colorClass: 'text-pink-400',
    activeBg: 'bg-pink-500/20 border-pink-500/40 text-pink-300 shadow-pink-500/10',
    icon: <Headphones size={14} className="text-pink-400" />
  }
];

export default function MusicSection() {
  const colors = useThemeColors();
  const {
    currentTrack,
    isPlaying,
    playlist,
    playTrack,
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
    isLoadingAudio
  } = useMusic();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MusicTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [hasSearched, setHasSearched] = useState(false);
  const [musicSource, setMusicSource] = useState<MusicSource>('octave');

  // Load initial trending music on mount
  useEffect(() => {
    loadTrendingMusic();
  }, []);

  const fetchClientBySource = async (source: MusicSource, query: string, pageNum: number, limit = 30): Promise<any[]> => {
    switch (source) {
      case 'deezer':
        return fetchClientDeezer(query, pageNum, limit);
      case 'octave':
        return fetchClientOctave(query, pageNum, limit);
      case 'youtube':
        return fetchClientYouTube(query, pageNum, limit);
      case 'soundcloud':
        return fetchClientSoundCloud(query, pageNum, limit);
      default:
        return fetchClientDeezer(query, pageNum, limit);
    }
  };

  const loadTrendingMusic = async (source = musicSource) => {
    setIsSearching(true);
    setHasSearched(false);
    setPage(1);
    try {
      const endpoint = `/api/music/trending?source=${source}&limit=30`;
      const res = await fetch(endpoint).catch(() => null);
      if (res && res.ok) {
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data.songs) && data.songs.length > 0) {
          setSearchResults(data.songs);
          setHasMore(data.songs.length >= 30);
          return;
        }
      }

      // Direct client fallback
      const fallbackSongs = await fetchClientBySource(source, '', 1, 30);
      setSearchResults(fallbackSongs);
      setHasMore(fallbackSongs.length >= 30);
    } catch (err) {
      console.warn('Backend trending fetch failed, fallback to client API:', err);
      const fallbackSongs = await fetchClientBySource(source, '', 1, 30);
      setSearchResults(fallbackSongs);
      setHasMore(fallbackSongs.length >= 30);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle manual search
  const handleSearch = async (e?: React.FormEvent, overrideKeyword?: string, source = musicSource) => {
    if (e) e.preventDefault();
    const query = (overrideKeyword !== undefined ? overrideKeyword : searchQuery).trim();

    if (!query) {
      loadTrendingMusic(source);
      return;
    }

    setIsSearching(true);
    setPage(1);
    setHasMore(true);
    setHasSearched(true);

    try {
      const endpoint = `/api/music/search?keyword=${encodeURIComponent(query)}&source=${source}&page=1&limit=30`;
      const res = await fetch(endpoint).catch(() => null);
      if (res && res.ok) {
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data.songs) && data.songs.length > 0) {
          setSearchResults(data.songs);
          if (data.songs.length < 30) {
            setHasMore(false);
          }
          return;
        }
      }

      // Direct client fallback
      const fallbackSongs = await fetchClientBySource(source, query, 1, 30);
      setSearchResults(fallbackSongs);
      setHasMore(fallbackSongs.length >= 30);
    } catch (err) {
      console.warn('Backend search failed, fallback to client API:', err);
      const fallbackSongs = await fetchClientBySource(source, query, 1, 30);
      setSearchResults(fallbackSongs);
      setHasMore(fallbackSongs.length >= 30);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSourceChange = (newSource: MusicSource) => {
    setMusicSource(newSource);
    if (searchQuery.trim()) {
      handleSearch(undefined, searchQuery, newSource);
    } else {
      loadTrendingMusic(newSource);
    }
  };

  // Load more tracks on scroll
  const handleLoadMore = async () => {
    if (isSearching || isLoadingMore || !hasMore) return;

    const nextPage = page + 1;
    setIsLoadingMore(true);

    try {
      const query = searchQuery.trim();
      const endpoint = query
        ? `/api/music/search?keyword=${encodeURIComponent(query)}&source=${musicSource}&page=${nextPage}&limit=30`
        : `/api/music/trending?source=${musicSource}&limit=30&page=${nextPage}`;

      const res = await fetch(endpoint).catch(() => null);
      if (res && res.ok) {
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data.songs) && data.songs.length > 0) {
          setSearchResults(prev => [...prev, ...data.songs]);
          setPage(nextPage);
          if (data.songs.length < 30) {
            setHasMore(false);
          }
          return;
        }
      }

      // Direct client fallback
      const fallbackSongs = await fetchClientBySource(musicSource, query, nextPage, 30);
      if (fallbackSongs.length > 0) {
        setSearchResults(prev => [...prev, ...fallbackSongs]);
        setPage(nextPage);
        setHasMore(fallbackSongs.length >= 30);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.warn('Backend load more failed, fallback to client API:', err);
      const query = searchQuery.trim();
      const fallbackSongs = await fetchClientBySource(musicSource, query, nextPage, 30);
      if (fallbackSongs.length > 0) {
        setSearchResults(prev => [...prev, ...fallbackSongs]);
        setPage(nextPage);
        setHasMore(fallbackSongs.length >= 30);
      } else {
        setHasMore(false);
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Scroll handler
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 100) {
      handleLoadMore();
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs === 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="space-y-8">
      {/* Header & Master Player Deck */}
      <div className="p-6 md:p-8 bg-zinc-900/60 border border-zinc-800/80 rounded-3xl space-y-6 shadow-xl backdrop-blur-md">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center shadow-inner">
              <Disc size={26} style={{ color: colors.hexPrimary }} className={isPlaying ? 'animate-spin' : ''} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
                Music Player
              </h2>
            </div>
          </div>
        </div>

        {/* Master Player Deck */}
        <div className="bg-zinc-950/90 border border-zinc-800/80 p-6 rounded-2xl space-y-5 shadow-2xl">
          <div className="flex flex-col md:flex-row items-center gap-6">
            {/* Album Art */}
            <div className="relative w-24 h-24 rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 flex-shrink-0 flex items-center justify-center shadow-lg">
              {currentTrack?.pic ? (
                <img
                  src={currentTrack.pic}
                  alt={currentTrack.name}
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                  className={`w-full h-full object-cover relative z-10 transition-transform duration-700 ${isPlaying ? 'scale-105' : ''}`}
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <Disc size={32} className={`text-zinc-600 absolute ${isPlaying ? 'animate-spin' : ''}`} />
              {isLoadingAudio && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-20">
                  <Loader2 size={26} className="animate-spin text-white" />
                </div>
              )}
            </div>

            {/* Title & Artist */}
            <div className="flex-1 min-w-0 text-center md:text-left space-y-1.5">
              <h4 className="text-xl font-bold text-white truncate">
                {currentTrack ? currentTrack.name : 'No track playing'}
              </h4>
              <div className="flex items-center justify-center md:justify-start gap-1.5 text-sm text-zinc-400 truncate">
                <span className="truncate">{currentTrack ? currentTrack.artist : NO_TRACK_ARTIST_PLACEHOLDER}</span>
                {currentTrack?.isVerified && (
                  <span title="Verified Artist"><BadgeCheck size={16} className="text-sky-400 flex-shrink-0" /></span>
                )}
                {currentTrack?.album && !isPlatformName(currentTrack.album) && <span className="truncate">• {currentTrack.album}</span>}
              </div>
            </div>

            {/* Playback Controls */}
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={prevTrack}
                disabled={playlist.length <= 1}
                className="p-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-2xl border border-zinc-800 transition-all cursor-pointer disabled:opacity-30"
                title="Previous track"
              >
                <SkipBack size={20} />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                disabled={!currentTrack}
                className="p-4 rounded-2xl bg-white hover:bg-zinc-200 text-black font-bold shadow-lg transition-all cursor-pointer disabled:opacity-30 scale-100 active:scale-95"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={22} /> : <Play size={22} className="ml-0.5" />}
              </button>

              <button
                type="button"
                onClick={nextTrack}
                disabled={playlist.length <= 1}
                className="p-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-2xl border border-zinc-800 transition-all cursor-pointer disabled:opacity-30"
                title="Next track"
              >
                <SkipForward size={20} />
              </button>

              {/* Stop Button */}
              <button
                type="button"
                onClick={stopMusic}
                disabled={!currentTrack && !isPlaying}
                className="p-3 bg-zinc-900 hover:bg-red-950/60 text-zinc-400 hover:text-red-400 rounded-2xl border border-zinc-800 hover:border-red-900/60 transition-all cursor-pointer disabled:opacity-30"
                title="Stop & clear current track"
              >
                <X size={20} />
              </button>

              {/* Repeat Button */}
              <button
                type="button"
                onClick={toggleRepeat}
                className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center gap-1.5 ${
                  isRepeating
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 shadow-md shadow-emerald-500/10'
                    : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-500 border-zinc-800'
                }`}
                title={isRepeating ? 'Repeat Mode: Enabled' : 'Repeat Mode: Disabled'}
              >
                <Repeat size={18} />
              </button>
            </div>

            {/* Volume Slider */}
            <div className="flex items-center gap-2.5 w-full md:w-36 pt-2 md:pt-0">
              <button
                type="button"
                onClick={() => setVolume(volume === 0 ? 0.7 : 0)}
                className="text-zinc-400 hover:text-white transition-colors"
                title={volume === 0 ? 'Unmute' : 'Mute'}
              >
                {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full accent-emerald-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                title="Volume"
              />
            </div>
          </div>

          {/* Scrub Bar & Timeline */}
          <div className="space-y-1.5 pt-2">
            <div className="relative w-full h-2.5 bg-zinc-900 rounded-full overflow-hidden cursor-pointer group">
              <div
                className="h-full bg-emerald-400 rounded-full transition-all duration-100 group-hover:bg-emerald-300"
                style={{ width: `${progressPercent}%` }}
              />
              <input
                type="range"
                min="0"
                max={duration || 100}
                value={currentTime}
                onChange={(e) => seek(parseFloat(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                title="Seek position"
              />
            </div>
            <div className="flex justify-between text-xs font-mono text-zinc-500">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Music Search & Multi-Source Explorer */}
      <section className="p-6 md:p-8 bg-zinc-900/40 border border-zinc-800/60 rounded-3xl space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Search size={20} style={{ color: colors.hexPrimary }} />
            <div>
              <h3 className="text-lg font-bold text-white">
                {hasSearched && searchQuery.trim() ? `Results for "${searchQuery}"` : 'Browse Music & Sources'}
              </h3>
            </div>
          </div>
        </div>

        {/* Multi-Source Selector Tabs */}
        <div className="flex flex-wrap items-center gap-2 bg-zinc-950/80 p-2 rounded-2xl border border-zinc-800/80">
          {SOURCES.map((s) => {
            const isSelected = musicSource === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSourceChange(s.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 border ${
                  isSelected
                    ? `${s.activeBg} shadow-md`
                    : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'
                }`}
              >
                {s.icon}
                <span>{s.name}</span>
              </button>
            );
          })}
        </div>

        {/* Search Input Bar */}
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder={SEARCH_PLACEHOLDER_TEXT}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3 text-sm bg-zinc-950/80 border border-zinc-800 rounded-2xl text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all"
            />
            <Search size={18} className="absolute left-4 top-3.5 text-zinc-500" />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setHasSearched(false);
                  loadTrendingMusic();
                }}
                className="absolute right-3.5 top-3 text-zinc-500 hover:text-zinc-300"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={isSearching}
            className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl text-sm font-semibold transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-md"
          >
            {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
            Search
          </button>
        </form>

        {/* Search Results Grid */}
        <div
          onScroll={handleScroll}
          className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1.5 custom-scrollbar"
        >
          {searchResults.length === 0 && !isSearching && hasSearched && (
            <div className="py-16 text-center space-y-2">
              <Music2 size={36} className="mx-auto text-zinc-600" />
              <p className="text-sm font-medium text-zinc-400">No tracks found</p>
              <p className="text-xs text-zinc-600">
                Try searching for another song title or artist.
              </p>
            </div>
          )}

          {searchResults.map((song, idx) => {
            const isCurrent = currentTrack && String(currentTrack.id) === String(song.id);
            return (
              <div
                key={`${song.id}-${idx}`}
                onClick={() => {
                  if (isCurrent) {
                    togglePlay();
                  } else {
                    playTrack(song, searchResults);
                  }
                }}
                className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer group ${
                  isCurrent
                    ? 'bg-zinc-800/90 border-zinc-600 text-white shadow-lg ring-1 ring-white/10'
                    : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700 text-zinc-300 hover:bg-zinc-900/50'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <span className="w-6 text-center text-xs font-mono text-zinc-500 flex-shrink-0">
                    {idx + 1}
                  </span>
                  <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex-shrink-0 flex items-center justify-center">
                    {song.pic ? (
                      <img
                        src={song.pic}
                        alt={song.name}
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                        }}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                    <Disc size={20} className="text-zinc-600 absolute" />
                    {isCurrent && isPlaying && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className={`text-sm font-semibold truncate ${isCurrent ? 'text-emerald-400' : 'text-zinc-100 group-hover:text-white'}`}>
                      {song.name}
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-zinc-400 truncate">
                      <span className="truncate">{song.artist}</span>
                      {song.isVerified && (
                        <BadgeCheck size={14} className="text-sky-400 flex-shrink-0" />
                      )}
                      {song.album && !isPlatformName(song.album) && <span className="truncate opacity-75">• {song.album}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0 text-xs font-mono text-zinc-500">
                  <span>{song.formattedDuration || (song.duration ? formatTime(song.duration) : '')}</span>
                  <div className={`p-2 rounded-xl border transition-all ${
                    isCurrent
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                      : 'bg-zinc-900 border-zinc-800 group-hover:border-zinc-700 text-zinc-400 group-hover:text-white'
                  }`}>
                    {isCurrent && isPlaying ? <Pause size={14} /> : <Play size={14} />}
                  </div>
                </div>
              </div>
            );
          })}

          {isLoadingMore && (
            <div className="py-6 flex items-center justify-center text-zinc-500 gap-2 text-xs">
              <Loader2 size={16} className="animate-spin text-zinc-400" />
              Loading more tracks...
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

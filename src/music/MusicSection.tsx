import React, { useState, useEffect } from 'react';
import { useMusic, MusicTrack } from './MusicContext';
import { useThemeColors } from '../context/ThemeContext';
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
  Infinity as InfinityIcon,
  BadgeCheck,
  Info
} from 'lucide-react';

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
    isLoadingAudio,
    currentLyricLine
  } = useMusic();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MusicTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [hasSearched, setHasSearched] = useState(false);
  const [musicSource, setMusicSource] = useState<'soundcloud' | 'octave'>('octave');

  // Load initial trending music on mount
  useEffect(() => {
    loadTrendingMusic();
  }, []);

  const loadTrendingMusic = async (source = musicSource) => {
    setIsSearching(true);
    setHasSearched(false);
    setPage(1);
    try {
      const endpoint = source === 'octave' 
        ? `/api/music/octave/trending?limit=30` 
        : `/api/music/trending?limit=30`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if (Array.isArray(data.songs) && data.songs.length > 0) {
        setSearchResults(data.songs);
        setHasMore(data.songs.length >= 30);
      } else {
        setSearchResults([]);
        setHasMore(false);
      }
    } catch (err) {
      console.error('Failed to load trending tracks:', err);
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
      const endpoint = source === 'octave'
        ? `/api/music/octave/search?keyword=${encodeURIComponent(query)}&page=1&limit=30`
        : `/api/music/search?keyword=${encodeURIComponent(query)}&page=1&limit=30`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if (Array.isArray(data.songs)) {
        setSearchResults(data.songs);
        if (data.songs.length < 30) {
          setHasMore(false);
        }
      } else {
        setSearchResults([]);
        setHasMore(false);
      }
    } catch (err) {
      console.error('Search error:', err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSourceChange = (newSource: 'soundcloud' | 'octave') => {
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
        ? `/api/music/search?keyword=${encodeURIComponent(query)}&page=${nextPage}&limit=30`
        : `/api/music/trending?limit=30&page=${nextPage}`;

      const res = await fetch(endpoint);
      const data = await res.json();
      if (Array.isArray(data.songs) && data.songs.length > 0) {
        setSearchResults(prev => [...prev, ...data.songs]);
        setPage(nextPage);
        if (data.songs.length < 30) {
          setHasMore(false);
        }
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('Load more error:', err);
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
      <div className="p-6 md:p-8 bg-zinc-900/60 border border-zinc-800/80 rounded-3xl space-y-6 shadow-xl">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center shadow-inner">
              <Disc size={26} style={{ color: colors.hexPrimary }} className={isPlaying ? 'animate-spin' : ''} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">
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
                <span className="truncate">{currentTrack ? currentTrack.artist : 'Search any song or artist below'}</span>
                {currentTrack?.isVerified && (
                  <span title="Verified Artist"><BadgeCheck size={16} className="text-sky-400 flex-shrink-0" /></span>
                )}
                {currentTrack?.album && <span className="truncate">• {currentTrack.album}</span>}
              </div>

              {/* Track Lyric Line */}
              {currentLyricLine && (
                <p className="text-xs font-mono text-emerald-400 truncate bg-emerald-950/30 px-2.5 py-1 rounded-lg border border-emerald-800/40 inline-block max-w-full">
                  ♪ {currentLyricLine}
                </p>
              )}
            </div>

            {/* Playback Controls & Infinite Repeat Button */}
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={prevTrack}
                disabled={playlist.length === 0}
                className="p-3 text-zinc-400 hover:text-white hover:bg-zinc-800/80 rounded-2xl transition-colors cursor-pointer disabled:opacity-30"
                title="Previous Track"
              >
                <SkipBack size={22} />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                disabled={!currentTrack}
                className={`p-4 rounded-2xl text-white font-bold transition-all transform hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-30 shadow-lg ${colors.primaryBg}`}
                style={{ backgroundColor: colors.hexPrimary }}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isLoadingAudio ? (
                  <Loader2 size={24} className="animate-spin" />
                ) : isPlaying ? (
                  <Pause size={24} />
                ) : (
                  <Play size={24} className="ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={nextTrack}
                disabled={playlist.length === 0}
                className="p-3 text-zinc-400 hover:text-white hover:bg-zinc-800/80 rounded-2xl transition-colors cursor-pointer disabled:opacity-30"
                title="Next Track"
              >
                <SkipForward size={22} />
              </button>

              {/* Infinite Repeat Button */}
              <button
                type="button"
                onClick={toggleRepeat}
                className={`p-3 rounded-2xl transition-all cursor-pointer ${
                  isRepeating
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-inner ring-1 ring-emerald-500/30'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/80'
                }`}
                title={isRepeating ? 'Repeat: Infinite Loop ON' : 'Repeat: OFF'}
              >
                {isRepeating ? <InfinityIcon size={24} className="text-emerald-400" /> : <Repeat size={22} />}
              </button>

              {/* Close & Stop Player */}
              {currentTrack && (
                <button
                  type="button"
                  onClick={stopMusic}
                  className="p-3 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-2xl transition-colors cursor-pointer ml-1"
                  title="Close & Stop Music"
                >
                  <X size={22} />
                </button>
              )}
            </div>

            {/* Volume Control */}
            <div className="flex items-center gap-2.5 w-36 pl-3 border-l border-zinc-800">
              <button
                type="button"
                onClick={() => setVolume(volume > 0 ? 0 : 0.7)}
                className="text-zinc-400 hover:text-white transition-colors"
                title={volume === 0 ? 'Unmute' : 'Mute'}
              >
                {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
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

      {/* Music Search & Explorer */}
      <section className="p-6 md:p-8 bg-zinc-900/40 border border-zinc-800/60 rounded-3xl space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Search size={20} style={{ color: colors.hexPrimary }} />
            <div>
              <h3 className="text-lg font-bold text-white">
                {hasSearched && searchQuery.trim() ? `Results for "${searchQuery}"` : 'Browse Music'}
              </h3>
            </div>
          </div>
        </div>

        {/* Music Source Selector */}
        <div className="flex items-center gap-1.5 bg-zinc-950/80 p-1.5 rounded-2xl border border-zinc-800/80 w-fit">
          <button
            type="button"
            onClick={() => handleSourceChange('soundcloud')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              musicSource === 'soundcloud'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            SoundCloud
          </button>

          <button
            type="button"
            onClick={() => handleSourceChange('octave')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              musicSource === 'octave'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-purple-300" />
            Octave
          </button>
        </div>

        {/* SoundCloud Notice */}
        {musicSource === 'soundcloud' && (
          <div className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-950/80 border border-zinc-800/80 px-3.5 py-2.5 rounded-xl">
            <Info size={15} className="text-emerald-400 flex-shrink-0" />
            <span>Note: Anyone can upload to SoundCloud, so you might need to be specific with song names.</span>
          </div>
        )}

        {/* Search Input Bar */}
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder={`Search any song, artist, or genre (e.g. montagem, phonk, lofi, rock, rap)...`}
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
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex-shrink-0 flex items-center justify-center relative shadow-sm">
                    {song.pic ? (
                      <img
                        src={song.pic}
                        alt=""
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                        }}
                        className="w-full h-full object-cover relative z-10"
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                    <Disc size={20} className="text-zinc-600 absolute" />
                  </div>
                  <div className="truncate">
                    <p className={`text-sm font-semibold truncate ${isCurrent ? 'text-emerald-400' : 'text-white'}`}>
                      {song.name}
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-zinc-400 truncate mt-0.5">
                      <span className="truncate">{song.artist}</span>
                      {song.isVerified && (
                        <span title="Verified Artist"><BadgeCheck size={14} className="text-sky-400 flex-shrink-0" /></span>
                      )}
                      {song.album && <span className="truncate">• {song.album}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  {song.formattedDuration ? (
                    <span className="text-xs font-mono text-zinc-500 hidden sm:inline">
                      {song.formattedDuration}
                    </span>
                  ) : null}

                  <button
                    type="button"
                    className={`p-2.5 rounded-xl transition-all ${
                      isCurrent && isPlaying
                        ? 'bg-emerald-500 text-black'
                        : 'text-zinc-400 group-hover:text-white group-hover:bg-zinc-800'
                    }`}
                    title={isCurrent && isPlaying ? 'Pause' : 'Play'}
                  >
                    {isCurrent && isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
                  </button>
                </div>
              </div>
            );
          })}

          {/* Loading indicator */}
          {isLoadingMore && (
            <div className="py-4 flex items-center justify-center gap-2 text-xs font-medium text-zinc-400">
              <Loader2 size={16} className="animate-spin text-emerald-400" />
              <span>Loading more tracks...</span>
            </div>
          )}

          {/* Load more button */}
          {hasMore && searchResults.length >= 30 && !isLoadingMore && !isSearching && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={handleLoadMore}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 rounded-xl transition-colors cursor-pointer"
              >
                Load more tracks
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

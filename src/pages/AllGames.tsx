import { useState, useEffect } from 'react';
import { allGamesList, GameCard } from '../games';
import PageLayout from '../components/PageLayout';
import SearchBar from '../components/SearchBar';

export default function AllGames() {
  const [acknowledged, setAcknowledged] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [games, setGames] = useState<any[]>([]);
  const [visibleCount, setVisibleCount] = useState(100);

  useEffect(() => {
    const initialList = allGamesList.map(g => ({ ...g, source: 'local' }));
    initialList.sort((a, b) =>
      (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' })
    );
    setGames(initialList);
  }, []);

  const filteredGames = games.filter(game => {
    const query = searchQuery.toLowerCase();
    return (
      game.title.toLowerCase().includes(query) ||
      game.description?.toLowerCase().includes(query)
    );
  });

  const displayedGames = filteredGames.slice(0, visibleCount);

  return (
    <PageLayout
      title="Our Games"
      showBack={true}
      maxWidth="7xl"
    >
      {!acknowledged ? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
          <h1 className="text-2xl sm:text-4xl font-bold text-white tracking-tight uppercase leading-snug max-w-3xl">
            I'M REDOING THIS PAGE, MANY THINGS/GAMES MAY NOT WORK
          </h1>
          <button
            onClick={() => setAcknowledged(true)}
            className="mt-10 px-8 py-3 bg-white text-black hover:bg-zinc-200 rounded-lg font-semibold uppercase tracking-wide transition-colors cursor-pointer"
          >
            Continue
          </button>
        </div>
      ) : (
        <>
          <div className="mb-8 border-b border-zinc-800 pb-4">
            <h1 className="text-3xl font-bold text-white tracking-tight">OUR GAMES</h1>
            <p className="text-zinc-500 mt-2">
              Browse our selection of {games.length > 0 ? games.length : '...'} games!
            </p>
          </div>

          <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search all of our games..." />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {displayedGames.length > 0 ? (
              displayedGames.map((game, i) => (
                <GameCard
                  key={`${game.id}-${i}`}
                  game={game}
                />
              ))
            ) : (
              <div className="col-span-full text-center py-12 text-zinc-500">
                No games found matching "{searchQuery}"
              </div>
            )}
          </div>

          {filteredGames.length > visibleCount && (
            <div className="flex justify-center mt-12 mb-6">
              <button
                onClick={() => setVisibleCount(prev => prev + 100)}
                className="px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-800 rounded-lg font-medium transition-colors cursor-pointer"
              >
                Load More ({filteredGames.length - visibleCount} Remaining)
              </button>
            </div>
          )}
        </>
      )}
    </PageLayout>
  );
}

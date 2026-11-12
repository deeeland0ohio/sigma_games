import { useState } from 'react';
import PageLayout from '../components/PageLayout';
import MusicSection from './MusicSection';

export default function MusicPage() {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <PageLayout title="Music" showBack={true} backTo="/" backText="Back to Home">
      <div className="max-w-6xl mx-auto pb-16">
        {!acknowledged ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
            <h1 className="text-2xl sm:text-4xl font-bold text-white tracking-tight uppercase leading-snug max-w-3xl">
              I'M REDOING THIS PAGE, MANY THINGS/TRACKS MAY NOT WORK
            </h1>
            <button
              onClick={() => setAcknowledged(true)}
              className="mt-10 px-8 py-3 bg-white text-black hover:bg-zinc-200 rounded-lg font-semibold uppercase tracking-wide transition-colors cursor-pointer"
            >
              Continue
            </button>
          </div>
        ) : (
          <MusicSection />
        )}
      </div>
    </PageLayout>
  );
}

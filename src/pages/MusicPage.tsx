import { Music } from 'lucide-react';
import PageLayout from '../components/PageLayout';

export default function MusicPage() {
  return (
    <PageLayout
      title="Music"
      showBack
      backTo="/"
      backText="Back to Home"
      maxWidth="5xl"
    >
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-5">
          <Music className="w-14 h-14 mx-auto text-zinc-600" />
          <h1 className="text-3xl font-bold tracking-tight text-white">Music</h1>
          <p className="text-zinc-400">Remaking :(</p>
        </div>
      </div>
    </PageLayout>
  );
}

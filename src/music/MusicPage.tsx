import React from 'react';
import PageLayout from '../components/PageLayout';
import MusicSection from './MusicSection';

export default function MusicPage() {
  return (
    <PageLayout title="Music" showBack={true} backTo="/" backText="Back to Home">
      <div className="max-w-6xl mx-auto pb-16">
        <MusicSection />
      </div>
    </PageLayout>
  );
}

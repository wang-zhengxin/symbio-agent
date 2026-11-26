import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import FeatureGrid from '@/components/FeatureGrid';
import InteractiveDemo from '@/components/InteractiveDemo';
import UsageGuide from '@/components/UsageGuide';
import FaqFooter from '@/components/FaqFooter';

function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <FeatureGrid />
        <InteractiveDemo />
        <UsageGuide />
        <FaqFooter />
      </main>
    </div>
  );
}

export default App;

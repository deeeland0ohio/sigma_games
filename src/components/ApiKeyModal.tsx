import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  ExternalLink,
  Cloud,
  Laptop,
  HelpCircle,
  RefreshCw,
  Trash2,
  Save,
  Server
} from 'lucide-react';
import {
  getCustomGroqKey,
  setCustomGroqKey,
  getCustomGeminiKey,
  setCustomGeminiKey,
  getCustomEmisKey,
  setCustomEmisKey,
  verifyApiKey,
  fetchAiStatus,
  ServerAiStatus
} from '../utils/aiKeys';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeysUpdated?: () => void;
}

export default function ApiKeyModal({ isOpen, onClose, onKeysUpdated }: ApiKeyModalProps) {
  const [activeTab, setActiveTab] = useState<'manual' | 'cloudrun'>('manual');
  
  // Local state for keys
  const [groqKey, setGroqKeyState] = useState('');
  const [geminiKey, setGeminiKeyState] = useState('');
  const [emisKey, setEmisKeyState] = useState('');

  // Password visibility toggles
  const [showGroq, setShowGroq] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [showEmis, setShowEmis] = useState(false);

  // Status and testing
  const [serverStatus, setServerStatus] = useState<ServerAiStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);

  const [testingGroq, setTestingGroq] = useState(false);
  const [groqTestResult, setGroqTestResult] = useState<{ valid: boolean; message: string } | null>(null);

  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState<{ valid: boolean; message: string } | null>(null);

  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setGroqKeyState(getCustomGroqKey());
      setGeminiKeyState(getCustomGeminiKey());
      setEmisKeyState(getCustomEmisKey());
      setGroqTestResult(null);
      setGeminiTestResult(null);
      setSavedSuccess(false);

      setIsLoadingStatus(true);
      fetchAiStatus().then(status => {
        setServerStatus(status);
        setIsLoadingStatus(false);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    setCustomGroqKey(groqKey);
    setCustomGeminiKey(geminiKey);
    setCustomEmisKey(emisKey);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);

    fetchAiStatus().then(status => setServerStatus(status));
    if (onKeysUpdated) {
      onKeysUpdated();
    }
  };

  const handleTestGroq = async () => {
    const keyToTest = groqKey.trim() || (serverStatus?.serverEnvKeys.groq ? 'use-server-env' : '');
    if (!keyToTest) {
      setGroqTestResult({ valid: false, message: 'Please enter a Groq API key first.' });
      return;
    }
    setTestingGroq(true);
    setGroqTestResult(null);
    const res = await verifyApiKey('groq', keyToTest);
    setTestingGroq(false);
    setGroqTestResult(res);
  };

  const handleTestGemini = async () => {
    const keyToTest = geminiKey.trim() || (serverStatus?.serverEnvKeys.gemini ? 'use-server-env' : '');
    if (!keyToTest) {
      setGeminiTestResult({ valid: false, message: 'Please enter a Gemini API key first.' });
      return;
    }
    setTestingGemini(true);
    setGeminiTestResult(null);
    const res = await verifyApiKey('gemini', keyToTest);
    setTestingGemini(false);
    setGeminiTestResult(res);
  };

  const handleClear = (type: 'groq' | 'gemini' | 'emis') => {
    if (type === 'groq') {
      setGroqKeyState('');
      setCustomGroqKey('');
      setGroqTestResult(null);
    } else if (type === 'gemini') {
      setGeminiKeyState('');
      setCustomGeminiKey('');
      setGeminiTestResult(null);
    } else if (type === 'emis') {
      setEmisKeyState('');
      setCustomEmisKey('');
    }
    if (onKeysUpdated) {
      onKeysUpdated();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-2xl">
              <Key size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">AI & API Keys Setup</h2>
              <p className="text-xs text-zinc-400">Configure keys manually or link to Google Cloud Run</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800/80 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Server & Environment Status Banner */}
        <div className="px-6 py-3 bg-zinc-900/40 border-b border-zinc-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Server size={14} className="text-zinc-400" />
            <span className="text-zinc-400">Cloud Run / Server:</span>
            {isLoadingStatus ? (
              <span className="text-zinc-500 flex items-center gap-1">
                <RefreshCw size={12} className="animate-spin" /> Checking...
              </span>
            ) : serverStatus?.serverEnvKeys.groq || serverStatus?.serverEnvKeys.gemini ? (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium flex items-center gap-1">
                <CheckCircle2 size={12} /> Server Environment Active
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                No Server Keys Configured
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-zinc-500">
              Groq: {serverStatus?.activeKeys.hasGroqKey || Boolean(groqKey) ? (
                <strong className="text-emerald-400">Ready ✓</strong>
              ) : (
                <strong className="text-zinc-500">Missing</strong>
              )}
            </span>
            <span className="text-zinc-500">
              Gemini: {serverStatus?.activeKeys.hasGeminiKey || Boolean(geminiKey) ? (
                <strong className="text-emerald-400">Ready ✓</strong>
              ) : (
                <strong className="text-zinc-500">Missing</strong>
              )}
            </span>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-zinc-800/80 bg-zinc-900/20 px-6 pt-3 gap-2">
          <button
            onClick={() => setActiveTab('manual')}
            className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-semibold transition-all ${
              activeTab === 'manual'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Laptop size={14} />
            <span>Method 1: Add Keys Manually (Instant)</span>
          </button>
          <button
            onClick={() => setActiveTab('cloudrun')}
            className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-semibold transition-all ${
              activeTab === 'cloudrun'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Cloud size={14} />
            <span>Method 2: Google Cloud Run Guide</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {activeTab === 'manual' && (
            <div className="space-y-6">
              <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-2xl text-xs text-zinc-300 flex items-start gap-3">
                <HelpCircle size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white">Why add manually?</strong>
                  <p className="mt-1 text-zinc-400 leading-relaxed">
                    If you don't want to re-deploy your Google Cloud Run instance or deal with Cloud Console settings right now, you can paste your key directly here. It is saved in your browser and used immediately across all games, tools, and the AI chat!
                  </p>
                </div>
              </div>

              {/* Groq Key Input (Recommended) */}
              <div className="p-5 bg-zinc-900/40 border border-zinc-800/80 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    Groq API Key (Recommended)
                  </label>
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-400 hover:underline flex items-center gap-1 font-medium"
                  >
                    Get Free Groq Key <ExternalLink size={12} />
                  </a>
                </div>
                <p className="text-xs text-zinc-400">
                  Ultra-fast inference (500+ tokens/sec) for LLaMA 3.3, DeepSeek, and Groq models. 100% free with generous rate limits.
                </p>

                <div className="relative">
                  <input
                    type={showGroq ? 'text' : 'password'}
                    value={groqKey}
                    onChange={(e) => setGroqKeyState(e.target.value)}
                    placeholder="gsk_..."
                    className="w-full px-4 py-2.5 pr-24 bg-zinc-950 border border-zinc-700/80 rounded-xl text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowGroq(!showGroq)}
                      className="p-1.5 text-zinc-400 hover:text-white rounded-lg transition-colors"
                      title={showGroq ? 'Hide key' : 'Show key'}
                    >
                      {showGroq ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    {groqKey && (
                      <button
                        type="button"
                        onClick={() => handleClear('groq')}
                        className="p-1.5 text-zinc-400 hover:text-red-400 rounded-lg transition-colors"
                        title="Clear key"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleTestGroq}
                    disabled={testingGroq}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {testingGroq ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} className="text-emerald-400" />}
                    {testingGroq ? 'Testing...' : 'Test Connection'}
                  </button>

                  {groqTestResult && (
                    <span
                      className={`text-xs flex items-center gap-1 font-medium ${
                        groqTestResult.valid ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {groqTestResult.valid ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                      {groqTestResult.message}
                    </span>
                  )}
                </div>
              </div>

              {/* Gemini Key Input */}
              <div className="p-5 bg-zinc-900/40 border border-zinc-800/80 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400" />
                    Google Gemini API Key
                  </label>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:underline flex items-center gap-1 font-medium"
                  >
                    Get Free Gemini Key <ExternalLink size={12} />
                  </a>
                </div>
                <p className="text-xs text-zinc-400">
                  Used as resilient automatic failover and for high-reasoning Gemini models.
                </p>

                <div className="relative">
                  <input
                    type={showGemini ? 'text' : 'password'}
                    value={geminiKey}
                    onChange={(e) => setGeminiKeyState(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full px-4 py-2.5 pr-24 bg-zinc-950 border border-zinc-700/80 rounded-xl text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowGemini(!showGemini)}
                      className="p-1.5 text-zinc-400 hover:text-white rounded-lg transition-colors"
                    >
                      {showGemini ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    {geminiKey && (
                      <button
                        type="button"
                        onClick={() => handleClear('gemini')}
                        className="p-1.5 text-zinc-400 hover:text-red-400 rounded-lg transition-colors"
                        title="Clear key"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleTestGemini}
                    disabled={testingGemini}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {testingGemini ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} className="text-blue-400" />}
                    {testingGemini ? 'Testing...' : 'Test Connection'}
                  </button>

                  {geminiTestResult && (
                    <span
                      className={`text-xs flex items-center gap-1 font-medium ${
                        geminiTestResult.valid ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {geminiTestResult.valid ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                      {geminiTestResult.message}
                    </span>
                  )}
                </div>
              </div>

              {/* Emis Key (Optional) */}
              <div className="p-4 bg-zinc-900/20 border border-zinc-800/60 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-400">
                    Emis API Key (Optional)
                  </label>
                  {emisKey && (
                    <button
                      type="button"
                      onClick={() => handleClear('emis')}
                      className="text-[11px] text-zinc-500 hover:text-red-400 flex items-center gap-1"
                    >
                      <Trash2 size={11} /> Clear
                    </button>
                  )}
                </div>
                <input
                  type={showEmis ? 'text' : 'password'}
                  value={emisKey}
                  onChange={(e) => setEmisKeyState(e.target.value)}
                  placeholder="Custom Emis token (optional)"
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-zinc-600"
                />
              </div>
            </div>
          )}

          {activeTab === 'cloudrun' && (
            <div className="space-y-5 text-zinc-300 text-xs leading-relaxed">
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-300">
                <strong className="text-white block text-sm mb-1">
                  Why didn't local <code className="bg-emerald-950 px-1 py-0.5 rounded text-white">.env</code> work on Cloud Run?
                </strong>
                Google Cloud Run is a containerized, stateless environment. When you deploy or run containers in the cloud, files located on your local PC are never uploaded or read unless configured as environment variables in the Cloud Run service settings.
              </div>

              <div className="p-5 bg-zinc-900/40 border border-zinc-800 rounded-2xl space-y-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-black font-bold flex items-center justify-center text-xs">
                    1
                  </span>
                  Open Cloud Run in Google Cloud Console
                </h4>
                <p className="text-zinc-400 pl-7">
                  Go to the Google Cloud Console and navigate to <strong>Cloud Run</strong> (or search for Cloud Run in the top search bar).
                </p>
                <div className="pl-7">
                  <a
                    href="https://console.cloud.google.com/run"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-xs font-semibold transition-colors"
                  >
                    Open Google Cloud Run Console <ExternalLink size={13} />
                  </a>
                </div>
              </div>

              <div className="p-5 bg-zinc-900/40 border border-zinc-800 rounded-2xl space-y-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-black font-bold flex items-center justify-center text-xs">
                    2
                  </span>
                  Click "Edit & Deploy New Revision"
                </h4>
                <p className="text-zinc-400 pl-7">
                  Click your running service name from the list, then click the <strong>"Edit & Deploy New Revision"</strong> button in the top action bar.
                </p>
              </div>

              <div className="p-5 bg-zinc-900/40 border border-zinc-800 rounded-2xl space-y-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-black font-bold flex items-center justify-center text-xs">
                    3
                  </span>
                  Open the "Variables & Secrets" Tab
                </h4>
                <p className="text-zinc-400 pl-7">
                  Scroll down to the configuration section and click the <strong>"Variables & Secrets"</strong> tab. Under <strong>Environment variables</strong>, click <strong>"Add Variable"</strong>.
                </p>
                
                <div className="pl-7 space-y-2">
                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-1">
                    <div className="text-zinc-400">Variable 1:</div>
                    <div className="font-mono text-white text-[13px] font-bold">Name: <span className="text-emerald-400">GROQ_API_KEY</span></div>
                    <div className="font-mono text-zinc-400 text-[11px]">Value: your Groq API key (<code className="text-zinc-300">gsk_...</code>)</div>
                  </div>

                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-1">
                    <div className="text-zinc-400">Variable 2 (Optional failover):</div>
                    <div className="font-mono text-white text-[13px] font-bold">Name: <span className="text-blue-400">GEMINI_API_KEY</span></div>
                    <div className="font-mono text-zinc-400 text-[11px]">Value: your Google Gemini key (<code className="text-zinc-300">AIzaSy...</code>)</div>
                  </div>
                </div>
              </div>

              <div className="p-5 bg-zinc-900/40 border border-zinc-800 rounded-2xl space-y-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-black font-bold flex items-center justify-center text-xs">
                    4
                  </span>
                  Click "Deploy"
                </h4>
                <p className="text-zinc-400 pl-7">
                  Scroll to the bottom and click <strong>Deploy</strong>. Cloud Run will seamlessly start a new revision with the environment variables active for every user automatically!
                </p>
              </div>

              <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-2xl text-xs space-y-2">
                <h5 className="font-bold text-white flex items-center gap-1.5">
                  <Laptop size={14} className="text-zinc-400" />
                  Alternatively: Using gcloud CLI
                </h5>
                <p className="text-zinc-400">
                  If you deploy using Google Cloud CLI, you can set them with a single command:
                </p>
                <div className="p-3 bg-black rounded-xl font-mono text-[11px] text-emerald-400 overflow-x-auto">
                  gcloud run services update &lt;YOUR-SERVICE-NAME&gt; \<br />
                  &nbsp;&nbsp;--set-env-vars GROQ_API_KEY="gsk_...",GEMINI_API_KEY="AIzaSy..."
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-zinc-800/80 bg-zinc-900/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            {savedSuccess && (
              <span className="text-emerald-400 flex items-center gap-1 font-semibold animate-in fade-in">
                <CheckCircle2 size={15} /> Keys saved to browser!
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
            >
              Close
            </button>
            {activeTab === 'manual' && (
              <button
                onClick={handleSave}
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/10 flex items-center gap-1.5 active:scale-95"
              >
                <Save size={14} />
                Save Keys
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Small helper icon for embedding Zap
function Zap({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

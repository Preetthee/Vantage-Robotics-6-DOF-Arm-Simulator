import { Suspense, lazy, useRef, useState, useCallback, useEffect } from "react";
import ControlDashboard from "./components/ControlDashboard";
import type { Scene3DHandle } from "./components/Scene3D";
import { useArmState } from "./context/ArmStateContext";
import { testFireworksKey } from "./testApiKey";

const Scene3D = lazy(() => import("./components/Scene3D"));

function App() {
  const [urdfContent, setUrdfContent] = useState<string | null>(null);
  const [urdfFileName, setUrdfFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const sceneRef = useRef<Scene3DHandle>(null);
  const { setIKTarget } = useArmState();

  // Test Fireworks API key on mount
  useEffect(() => {
    testFireworksKey();
  }, []);

  const handleGroundClick = useCallback((position: THREE.Vector3) => {
    setIKTarget({
      position: { x: position.x, y: position.y, z: position.z },
      orientation: undefined,
    });
  }, [setIKTarget]);

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.urdf')) {
      alert('Please select a .urdf file');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setUrdfContent(reader.result as string);
      setUrdfFileName(file.name);
    };
    reader.onerror = () => alert('Failed to read file');
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  return (
    <div className="app-shell flex h-full w-full">
      {/* 3D viewport — fills available space */}
      <main
        className="viewport-shell relative flex-1 min-w-0"
        onDrop={urdfContent ? undefined : handleDrop}
        onDragOver={urdfContent ? undefined : handleDragOver}
        onDragLeave={urdfContent ? undefined : handleDragLeave}
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <span className="live-dot" />
                <span className="font-mono text-sm text-muted animate-pulse">
                  INITIALIZING 3D SCENE…
                </span>
              </div>
            </div>
          }
        >
          {urdfContent ? (
            <Scene3D ref={sceneRef} urdfContent={urdfContent} urdfFileName={urdfFileName || undefined} onGroundClick={handleGroundClick} />
          ) : (
            <Scene3D ref={sceneRef} onGroundClick={handleGroundClick} />
          )}
        </Suspense>

        <div className="scene-hud pointer-events-none absolute left-5 top-5 flex items-center gap-3 select-none">
          <div className="scene-hud-mark"><span className="live-dot" /></div>
          <div>
            <p className="font-heading text-xs font-semibold tracking-[0.16em] text-foreground/90">VANTAGE / SIMULATION</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-foreground/40">6-axis digital twin · safe workspace</p>
          </div>
        </div>

        {/* Upload overlay — shown when no URDF is loaded */}
        {!urdfContent && (
          <div
            className={`upload-overlay absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 transition-all duration-300 ${
              dragOver
                ? 'bg-primary/10 backdrop-blur-sm'
                : 'bg-background/60 backdrop-blur-[2px]'
            }`}
          >
            <div className="upload-card flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/10 text-primary shadow-lg shadow-primary/10">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="text-sm font-heading font-medium text-foreground/90">
                Load a URDF robot model
              </p>
              <p className="text-xs text-foreground/50 text-center max-w-[260px] leading-relaxed">
                Drag & drop a <code className="text-primary font-mono">.urdf</code> file here, or click to browse
              </p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="primary-action px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium shadow-lg shadow-primary/30 hover:brightness-110 active:scale-[0.97] transition-all duration-150"
            >
              Select URDF File
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".urdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>
        )}

        {/* Watermark overlay */}
        <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between pointer-events-none select-none">
          <span className="font-heading text-[10px] uppercase tracking-[0.2em] text-muted/40">
            Vantage Robotics — 6-DOF Industrial Arm
          </span>
          {urdfContent && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="pointer-events-auto px-2.5 py-1 rounded-lg bg-surface/60 backdrop-blur-sm border border-border/50 text-[10px] text-foreground/50 hover:text-foreground hover:bg-surface/80 transition-all duration-150 active:scale-[0.97]"
            >
              Change URDF
            </button>
          )}
        </div>
      </main>

      {/* Sidebar dashboard */}
      <aside className="control-rail w-[420px] min-w-[380px] max-w-[480px] overflow-y-auto border-l border-border/70">
        <ControlDashboard sceneRef={sceneRef} />
      </aside>
    </div>
  );
}

export default App;

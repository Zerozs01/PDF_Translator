import React, { useRef, useState, useEffect } from 'react';
import { useUIStore } from '../stores/useUIStore';
import { Region } from '../types';
import { FileImage } from 'lucide-react';

interface SmartCanvasProps {
  regions: Region[];
  onRegionUpdate?: (regions: Region[]) => void;
}

export const SmartCanvas: React.FC<SmartCanvasProps> = ({ regions }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { zoom, pan, setZoom, setPan, activeTool } = useUIStore();
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

  // Handle Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomSensitivity = 0.001;
      const delta = -e.deltaY * zoomSensitivity;
      const newZoom = Math.min(Math.max(zoom + delta, 0.1), 5);
      
      // Calculate zoom towards mouse pointer
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const scaleRatio = newZoom / zoom;
        const newPanX = mouseX - (mouseX - pan.x) * scaleRatio;
        const newPanY = mouseY - (mouseY - pan.y) * scaleRatio;

        setPan(newPanX, newPanY);
        setZoom(newZoom);
      }
    } else {
      // Normal scroll (Pan)
      setPan(pan.x - e.deltaX, pan.y - e.deltaY);
    }
  };

  // Handle Panning
  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'hand' || e.button === 1 || e.button === 2) { // Middle or Right click
      setIsDragging(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;
      setPan(pan.x + dx, pan.y + dy);
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Prevent context menu on canvas
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return (
    <div 
      ref={containerRef}
      className={`w-full h-full overflow-hidden bg-slate-950 relative ${activeTool === 'hand' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {/* Content Layer */}
      <div 
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: isDragging ? 'none' : 'transform 0.1s ease-out'
        }}
        className="absolute top-0 left-0"
      >
        {/* Placeholder Image / Paper */}
        <div className="relative bg-white shadow-2xl min-w-[800px] min-h-[1100px] flex flex-col items-center justify-center border border-slate-700 group">
             {/* Manga Content Simulation */}
             <div className="text-slate-200 flex flex-col items-center gap-6 select-none opacity-20 pointer-events-none">
                <FileImage size={120} strokeWidth={0.5} />
                <div className="text-center">
                  <p className="text-xl font-bold">WORKSPACE CANVAS</p>
                  <p className="text-sm italic">Place PDF or Scan for AI Analysis</p>
                </div>
             </div>

             {/* Regions Overlay */}
             {regions.map(reg => (
               <div 
                 key={reg.id}
                 style={{
                   left: reg.box.x,
                   top: reg.box.y,
                   width: reg.box.w,
                   height: reg.box.h
                 }}
                 className={`absolute border-2 border-dashed transition-all cursor-pointer hover:bg-opacity-20 ${
                   reg.type === 'balloon' ? 'border-green-500 bg-green-500/10' : 
                   reg.type === 'sfx' ? 'border-orange-500 bg-orange-500/10' :
                   'border-blue-500 bg-blue-500/10'
                 }`}
               >
                 <div className="flex flex-col gap-1 w-full overflow-hidden">
                    <span className={`text-[8px] px-1 rounded self-start text-white uppercase font-black ${
                      reg.type === 'balloon' ? 'bg-green-500' : 
                      reg.type === 'sfx' ? 'bg-orange-500' : 'bg-blue-500'
                    }`}>
                      {reg.type}
                    </span>
                    {reg.translatedText && (
                      <div className="bg-white text-slate-900 p-1 text-[10px] leading-tight rounded shadow-sm">
                        {reg.translatedText}
                      </div>
                    )}
                 </div>
               </div>
             ))}
        </div>
      </div>

      {/* HUD / Overlay Controls */}
      <div className="absolute bottom-4 right-4 bg-slate-800/80 backdrop-blur p-2 rounded-lg border border-slate-700 flex gap-4 text-xs text-slate-300">
        <span>Zoom: {Math.round(zoom * 100)}%</span>
        <span>X: {Math.round(pan.x)} Y: {Math.round(pan.y)}</span>
      </div>
    </div>
  );
};

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Palette, Eraser, Download, Trash2, Users, X, Undo, Redo } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface DrawAction {
  from: Point;
  to: Point;
  color: string;
  size: number;
  userId: string;
}

interface Cursor {
  userId: string;
  userName: string;
  color: string;
  position: Point;
}

interface CollaborativeCanvasProps {
  userId: string;
  userName: string;
  targetId: string;
  onDraw?: (action: Omit<DrawAction, 'userId'>) => void;
  onCursorMove?: (position: Point) => void;
  onClear?: () => void;
  onClose?: () => void;
}

// User colors for cursors
const USER_COLORS = [
  '#a855f7', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#06b6d4', '#3b82f6',
];

const BRUSH_COLORS = [
  '#ffffff', '#a855f7', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#6366f1', '#888888',
];

export function CollaborativeCanvas({
  userId,
  userName,
  targetId,
  onDraw,
  onCursorMove,
  onClear,
  onClose,
}: CollaborativeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const lastPosRef = useRef<Point | null>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#a855f7');
  const [brushSize, setBrushSize] = useState(4);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [remoteCursors, setRemoteCursors] = useState<Cursor[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const userColor = USER_COLORS[parseInt(userId.slice(-1), 16) % USER_COLORS.length];

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctxRef.current = ctx;
    
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#1a1a24';
      ctx.fillRect(0, 0, rect.width, rect.height);
    };
    
    resize();
    window.addEventListener('resize', resize);
    
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Save to history
  const saveToHistory = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory(prev => [...prev.slice(0, historyIndex + 1), imageData].slice(-20));
    setHistoryIndex(prev => Math.min(prev + 1, 19));
  }, [historyIndex]);

  // Undo
  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    const newIndex = historyIndex - 1;
    ctx.putImageData(history[newIndex], 0, 0);
    setHistoryIndex(newIndex);
  }, [history, historyIndex]);

  // Redo
  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    const newIndex = historyIndex + 1;
    ctx.putImageData(history[newIndex], 0, 0);
    setHistoryIndex(newIndex);
  }, [history, historyIndex]);

  // Get position
  const getPosition = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Start drawing
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getPosition(e);
    lastPosRef.current = pos;
    setIsDrawing(true);
    saveToHistory();
  };

  // Draw
  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    
    const pos = getPosition(e);
    onCursorMove?.(pos);
    
    if (!isDrawing || !lastPosRef.current) return;
    
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = tool === 'eraser' ? '#1a1a24' : color;
    ctx.lineWidth = tool === 'eraser' ? brushSize * 3 : brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    
    onDraw?.({
      from: lastPosRef.current,
      to: pos,
      color: tool === 'eraser' ? '#1a1a24' : color,
      size: tool === 'eraser' ? brushSize * 3 : brushSize,
    });
    
    lastPosRef.current = pos;
  };

  // Stop drawing
  const stopDrawing = () => {
    setIsDrawing(false);
    lastPosRef.current = null;
  };

  // Clear canvas
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    saveToHistory();
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(0, 0, rect.width, rect.height);
    onClear?.();
  };

  // Download canvas
  const downloadCanvas = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    setIsSaving(true);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `void-canvas-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      
      // Save to localStorage
      const saved = JSON.parse(localStorage.getItem('void-canvases') || '[]');
      saved.push({
        id: `canvas-${Date.now()}`,
        name: `Canvas ${new Date().toLocaleString()}`,
        data: dataUrl,
        createdAt: Date.now(),
      });
      localStorage.setItem('void-canvases', JSON.stringify(saved.slice(-10)));
    } finally {
      setIsSaving(false);
    }
  };

  // Handle remote draw
  const handleRemoteDraw = useCallback((action: DrawAction) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(action.from.x, action.from.y);
    ctx.lineTo(action.to.x, action.to.y);
    ctx.strokeStyle = action.color;
    ctx.lineWidth = action.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, []);

  // Handle remote cursor
  const handleRemoteCursor = useCallback((cursor: Cursor) => {
    setRemoteCursors(prev => [
      ...prev.filter(c => c.userId !== cursor.userId),
      cursor,
    ]);
  }, []);

  // Listen for remote events
  useEffect(() => {
    const handleCanvasDraw = (e: CustomEvent<DrawAction>) => handleRemoteDraw(e.detail);
    const handleRemoteCursor = (e: CustomEvent<Cursor>) => handleRemoteCursor(e.detail);
    
    window.addEventListener('void-canvas-draw', handleCanvasDraw as EventListener);
    window.addEventListener('void-cursor-update', handleRemoteCursor as EventListener);
    
    return () => {
      window.removeEventListener('void-canvas-draw', handleCanvasDraw as EventListener);
      window.removeEventListener('void-cursor-update', handleRemoteCursor as EventListener);
    };
  }, [handleRemoteDraw, handleRemoteCursor]);

  return (
    <div className="h-full flex flex-col bg-[#0f0f14]">
      {/* Toolbar */}
      <div className="h-12 flex items-center gap-2 px-3 border-b border-white/5 bg-[#1a1a24] shrink-0">
        <div className="flex items-center gap-1 bg-[#242430] rounded-lg p-1">
          <button onClick={() => setTool('brush')} className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${tool === 'brush' ? 'bg-purple-500 text-white' : 'text-gray-400 hover:text-white'}`}>
            <Palette className="w-4 h-4" />
          </button>
          <button onClick={() => setTool('eraser')} className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${tool === 'eraser' ? 'bg-purple-500 text-white' : 'text-gray-400 hover:text-white'}`}>
            <Eraser className="w-4 h-4" />
          </button>
        </div>
        
        <div className="flex items-center gap-1 bg-[#242430] rounded-lg p-1">
          <button onClick={undo} disabled={historyIndex <= 0} className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-white disabled:opacity-30">
            <Undo className="w-4 h-4" />
          </button>
          <button onClick={redo} disabled={historyIndex >= history.length - 1} className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-white disabled:opacity-30">
            <Redo className="w-4 h-4" />
          </button>
        </div>
        
        {/* Colors */}
        <div className="flex items-center gap-0.5">
          {BRUSH_COLORS.slice(0, 8).map(c => (
            <button key={c} onClick={() => { setTool('brush'); setColor(c); }} className={`w-5 h-5 rounded border-2 transition-transform hover:scale-110 ${color === c && tool === 'brush' ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: c }} />
          ))}
        </div>
        
        {/* Brush size */}
        <input type="range" min="1" max="30" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-16 accent-purple-500" />
        <span className="text-xs text-gray-400 w-4">{brushSize}</span>
        
        <div className="flex-1" />
        
        {/* Users */}
        <div className="flex items-center gap-1 text-gray-400">
          <Users className="w-4 h-4" />
          <span className="text-xs">{remoteCursors.length + 1}</span>
        </div>
        
        {/* Actions */}
        <button onClick={clearCanvas} className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
        <button onClick={downloadCanvas} disabled={isSaving} className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50">
          <Download className="w-4 h-4" />
        </button>
        {onClose && (
          <button onClick={onClose} className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      
      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} className="w-full h-full cursor-crosshair" />
        
        {/* Remote cursors */}
        <AnimatePresence>
          {remoteCursors.map(cursor => (
            <motion.div key={cursor.userId} initial={{ opacity: 0 }} animate={{ opacity: 1, x: cursor.position.x, y: cursor.position.y }} exit={{ opacity: 0 }} className="absolute pointer-events-none z-10" style={{ transform: 'translate(-50%, -50%)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="drop-shadow-lg">
                <path d="M5 3L19 12L12 13L9 20L5 3Z" fill={cursor.color} stroke="white" strokeWidth="1.5" />
              </svg>
              <div className="absolute top-5 left-4 px-2 py-0.5 rounded text-xs text-white whitespace-nowrap" style={{ backgroundColor: cursor.color }}>
                {cursor.userName}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

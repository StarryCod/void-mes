'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Download, Users, X, Save, Upload } from 'lucide-react';

interface Cursor {
  userId: string;
  userName: string;
  color: string;
  position: number;
  selectionStart: number;
  selectionEnd: number;
}

interface CollaborativeDocumentProps {
  userId: string;
  userName: string;
  targetId: string;
  onTextChange?: (text: string) => void;
  onCursorMove?: (position: number, selectionStart: number, selectionEnd: number) => void;
  onClose?: () => void;
}

const USER_COLORS = [
  '#a855f7', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#06b6d4', '#3b82f6',
];

export function CollaborativeDocument({
  userId,
  userName,
  targetId,
  onTextChange,
  onCursorMove,
  onClose,
}: CollaborativeDocumentProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  
  const [content, setContent] = useState('');
  const [remoteCursors, setRemoteCursors] = useState<Cursor[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [savedDocuments, setSavedDocuments] = useState<{id: string; name: string; content: string; createdAt: number}[]>([]);
  
  const userColor = USER_COLORS[parseInt(userId.slice(-1), 16) % USER_COLORS.length];

  // Load saved documents
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('void-documents') || '[]');
    setSavedDocuments(saved);
  }, []);

  // Handle text change
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setContent(text);
    setHasUnsavedChanges(true);
    onTextChange?.(text);
    
    // Broadcast change
    window.dispatchEvent(new CustomEvent('void-document-update', {
      detail: { targetId, text }
    }));
  };

  // Handle cursor/selection change
  const handleSelect = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    onCursorMove?.(textarea.selectionStart, textarea.selectionStart, textarea.selectionEnd);
    
    // Broadcast cursor position
    window.dispatchEvent(new CustomEvent('void-document-cursor', {
      detail: {
        targetId,
        userId,
        userName,
        color: userColor,
        position: textarea.selectionStart,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
      }
    }));
  };

  // Save document
  const saveDocument = async () => {
    setIsSaving(true);
    try {
      const doc = {
        id: `doc-${Date.now()}`,
        name: `Document ${new Date().toLocaleString()}`,
        content,
        createdAt: Date.now(),
      };
      
      const saved = JSON.parse(localStorage.getItem('void-documents') || '[]');
      saved.push(doc);
      localStorage.setItem('void-documents', JSON.stringify(saved.slice(-20)));
      
      setSavedDocuments(saved.slice(-20));
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
    } finally {
      setIsSaving(false);
    }
  };

  // Download document
  const downloadDocument = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const link = document.createElement('a');
    link.download = `void-doc-${Date.now()}.txt`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // Load document
  const loadDocument = (doc: {content: string}) => {
    setContent(doc.content);
    setHasUnsavedChanges(false);
  };

  // Import file
  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setContent(text);
        setHasUnsavedChanges(true);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // Handle remote cursor
  const handleRemoteCursor = useCallback((cursor: Cursor) => {
    setRemoteCursors(prev => [
      ...prev.filter(c => c.userId !== cursor.userId),
      cursor,
    ]);
  }, []);

  // Handle remote text update
  const handleRemoteText = useCallback((text: string) => {
    setContent(text);
  }, []);

  // Listen for remote events
  useEffect(() => {
    const handleCursorUpdate = (e: CustomEvent<Cursor>) => handleRemoteCursor(e.detail);
    const handleTextUpdate = (e: CustomEvent<{text: string}>) => handleRemoteText(e.detail.text);
    
    window.addEventListener('void-document-cursor', handleCursorUpdate as EventListener);
    window.addEventListener('void-remote-document', handleTextUpdate as EventListener);
    
    return () => {
      window.removeEventListener('void-document-cursor', handleCursorUpdate as EventListener);
      window.removeEventListener('void-remote-document', handleTextUpdate as EventListener);
    };
  }, [handleRemoteCursor, handleRemoteText]);

  // Auto-save
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const timer = setTimeout(() => {
      saveDocument();
    }, 30000);
    return () => clearTimeout(timer);
  }, [content, hasUnsavedChanges]);

  // Render cursor indicators
  const renderCursorIndicators = () => {
    const textarea = textareaRef.current;
    if (!textarea) return null;
    
    return remoteCursors.map(cursor => {
      // Calculate position based on character index
      const text = content.substring(0, cursor.position);
      const lines = text.split('\n');
      const lineNum = lines.length;
      const charNum = lines[lines.length - 1].length;
      
      return (
        <motion.div
          key={cursor.userId}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          className="absolute pointer-events-none z-10"
          style={{
            backgroundColor: cursor.color,
            width: '2px',
            height: '20px',
            // Position would need proper calculation based on textarea dimensions
          }}
        >
          <div
            className="absolute -top-5 left-0 px-1.5 py-0.5 rounded text-xs text-white whitespace-nowrap"
            style={{ backgroundColor: cursor.color }}
          >
            {cursor.userName}
          </div>
        </motion.div>
      );
    });
  };

  return (
    <div className="h-full flex flex-col bg-[#0f0f14]">
      {/* Toolbar */}
      <div className="h-12 flex items-center gap-2 px-3 border-b border-white/5 bg-[#1a1a24] shrink-0">
        <div className="flex items-center gap-1">
          <FileText className="w-4 h-4 text-purple-400" />
          <span className="text-sm text-white">Документ</span>
        </div>
        
        <div className="flex-1" />
        
        {/* Status */}
        {hasUnsavedChanges && (
          <span className="text-xs text-yellow-400">Не сохранено</span>
        )}
        {lastSaved && !hasUnsavedChanges && (
          <span className="text-xs text-gray-500">Сохранено {lastSaved.toLocaleTimeString()}</span>
        )}
        
        {/* Users */}
        <div className="flex items-center gap-1 text-gray-400">
          <Users className="w-4 h-4" />
          <span className="text-xs">{remoteCursors.length + 1}</span>
        </div>
        
        {/* Actions */}
        <button onClick={importFile} className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
          <Upload className="w-4 h-4" />
        </button>
        <button onClick={saveDocument} disabled={isSaving} className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50">
          <Save className="w-4 h-4" />
        </button>
        <button onClick={downloadDocument} className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-purple-400 hover:bg-purple-500/10 transition-colors">
          <Download className="w-4 h-4" />
        </button>
        {onClose && (
          <button onClick={onClose} className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      
      {/* Editor */}
      <div className="flex-1 relative overflow-hidden">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleTextChange}
          onSelect={handleSelect}
          onKeyUp={handleSelect}
          onClick={handleSelect}
          placeholder="Начните печатать здесь... Изменения будут видны вашему собеседнику в реальном времени.

Поддерживается:
• Обычный текст
• Markdown (отображается при экспорте)
• Совместное редактирование

Документ автоматически сохраняется каждые 30 секунд."
          className="w-full h-full p-4 bg-transparent text-gray-100 text-sm font-mono resize-none border-none outline-none focus:ring-0"
          spellCheck="false"
        />
        
        {/* Remote cursor indicators */}
        <AnimatePresence>
          {renderCursorIndicators()}
        </AnimatePresence>
      </div>
      
      {/* Saved documents panel */}
      {savedDocuments.length > 0 && (
        <div className="h-32 border-t border-white/5 bg-[#1a1a24] overflow-y-auto">
          <div className="p-2">
            <p className="text-xs text-gray-500 mb-2">Сохранённые документы:</p>
            <div className="flex flex-wrap gap-2">
              {savedDocuments.map(doc => (
                <button
                  key={doc.id}
                  onClick={() => loadDocument(doc)}
                  className="px-3 py-1.5 bg-[#242430] hover:bg-[#2a2a34] rounded-lg text-xs text-gray-300 transition-colors"
                >
                  {doc.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

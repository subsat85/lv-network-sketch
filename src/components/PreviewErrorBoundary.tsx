import React, { Component, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, Download, X } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { serializeProject } from '../utils/projectSerialization';

interface Props {
  children: React.ReactNode;
  onClose: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const RecoveryActions: React.FC<{ error: Error | null, onReset: () => void, onClose: () => void }> = ({ error, onReset, onClose }) => {
  const { elements, style, poleSizeScale, consumerVariant, connectionDistances, connectionLabelOffsets, currentProjectId, currentProjectName, distanceTextScale, consumerSizeScale, electrical, distanceFlags } = useDrawingStore();

  const handleDownloadBackup = () => {
    try {
      const json = serializeProject(
        elements,
        style,
        poleSizeScale,
        consumerVariant,
        connectionDistances,
        connectionLabelOffsets,
        currentProjectId,
        currentProjectName,
        distanceTextScale,
        consumerSizeScale,
        electrical,
        distanceFlags
      );
      
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recovery-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to create backup:', e);
      alert('Failed to create backup. Please try taking a screenshot instead.');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-red-100">
        <div className="flex items-center gap-3 text-red-600 mb-4">
          <div className="p-3 bg-red-50 rounded-full">
            <AlertTriangle size={24} />
          </div>
          <h2 className="text-xl font-bold">Something went wrong</h2>
        </div>
        
        <p className="text-gray-600 mb-6">
          The preview screen encountered an error. Don't worry, your work is safe.
          You can download a backup of your project or try to reload the preview.
        </p>

        {error && (
          <div className="bg-gray-50 p-3 rounded-lg text-xs font-mono text-gray-500 mb-6 overflow-auto max-h-32">
            {error.toString()}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={handleDownloadBackup}
            className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            <Download size={18} />
            Download Project Backup
          </button>
          
          <div className="flex gap-3">
            <button
              onClick={onReset}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
            >
              <RefreshCw size={18} />
              Reload Preview
            </button>
            <button
              onClick={onClose}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg font-medium transition-colors"
            >
              <X size={18} />
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export class PreviewErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Preview Error Boundary caught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <RecoveryActions 
          error={this.state.error} 
          onReset={this.handleReset} 
          onClose={this.props.onClose} 
        />
      );
    }

    return this.props.children;
  }
}

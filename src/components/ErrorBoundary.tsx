import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="bg-white p-8 rounded-lg shadow border border-red-200 max-w-lg w-full">
            <h1 className="text-2xl font-bold text-red-600 mb-4">Something went wrong</h1>
            <p className="text-gray-700 mb-4">
              An unexpected error occurred in the application. Please try refreshing the page.
            </p>
            <div className="bg-gray-100 p-4 rounded overflow-auto max-h-64 text-sm text-gray-800 font-mono">
              {this.state.error && this.state.error.toString()}
            </div>
            <button 
              className="mt-6 w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded transition"
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

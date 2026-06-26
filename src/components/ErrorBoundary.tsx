import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Fängt Render-Fehler ab, damit ein einzelner Fehler nicht die GANZE App weiß macht
 * (z.B. ein fehlender Import / undefined-Komponente). Zeigt stattdessen eine Fehlermeldung.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="max-w-md w-full text-center space-y-4">
            <img src="/birgmann-logo.png" alt="Tischlerei Birgmann" className="h-12 mx-auto" />
            <h1 className="text-xl font-semibold">Es ist ein Fehler aufgetreten</h1>
            <p className="text-sm text-muted-foreground">
              Die Ansicht konnte nicht geladen werden. Bitte laden Sie die App neu.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground h-10 px-4 py-2 text-sm font-medium hover:bg-primary/90"
            >
              App neu laden
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

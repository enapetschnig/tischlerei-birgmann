import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import NotificationBell from "@/components/NotificationBell";

interface PageHeaderProps {
  title?: string;
  showBackButton?: boolean;
  backPath?: string;
}

export function PageHeader({ title, showBackButton = true, backPath }: PageHeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (backPath) {
      navigate(backPath);
    } else {
      navigate(-1);
    }
  };

  return (
    <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
      <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-2 sm:py-3">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            {showBackButton && (
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Zurück</span>
              </Button>
            )}
            <img
              src="/birgmann-logo.png"
              alt="Tischlerei Birgmann"
              className="h-10 sm:h-12 w-auto cursor-pointer hover:opacity-80 transition-opacity object-contain"
              onClick={() => navigate("/")}
            />
            {title && (
              <h1 className="text-lg sm:text-2xl font-bold truncate">{title}</h1>
            )}
          </div>
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}

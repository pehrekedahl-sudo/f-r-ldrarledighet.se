import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import TopNav from "@/components/TopNav";
import Index from "./pages/Index";
import PlanBuilder from "./pages/PlanBuilder";
import Wizard from "./pages/Wizard";
import Foraldraledighet101 from "./pages/Foraldraledighet101";
import NotFound from "./pages/NotFound";

const DevNav = lazy(() => import("@/components/DevNav"));
const TestEngine = lazy(() => import("./pages/TestEngine"));

const queryClient = new QueryClient();

const isDev = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("dev");

const AppContent = () => {
  const { pathname } = useLocation();
  const hideNav = pathname === "/wizard";

  return (
    <>
      {!hideNav && <TopNav />}
      {isDev && (
        <Suspense fallback={null}>
          <DevNav />
        </Suspense>
      )}
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/wizard" element={<Wizard />} />
        <Route path="/foraldraledighet-101" element={<Foraldraledighet101 />} />
        {isDev && (
          <Route path="/test-engine" element={
            <Suspense fallback={<div className="p-8 text-muted-foreground">Laddar…</div>}>
              <TestEngine />
            </Suspense>
          } />
        )}
        <Route path="/plan-builder" element={<PlanBuilder />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ErrorBoundary>
          <AppContent />
        </ErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

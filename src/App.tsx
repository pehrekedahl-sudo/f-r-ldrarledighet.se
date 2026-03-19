import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import DevNav from "@/components/DevNav";
import TopNav from "@/components/TopNav";
import Index from "./pages/Index";
import TestEngine from "./pages/TestEngine";
import PlanBuilder from "./pages/PlanBuilder";
import Wizard from "./pages/Wizard";
import Foraldraledighet101 from "./pages/Foraldraledighet101";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const isDev = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("dev");

const AppContent = () => {
  const { pathname } = useLocation();
  const hideNav = pathname === "/wizard";

  return (
    <>
      {!hideNav && <TopNav />}
      {isDev && <DevNav />}
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/wizard" element={<Wizard />} />
        <Route path="/foraldraledighet-101" element={<Foraldraledighet101 />} />
        <Route path="/test-engine" element={<TestEngine />} />
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
        <AppContent />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

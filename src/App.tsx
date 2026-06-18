import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { AuthSessionExpiredNotice } from "@/components/AuthSessionExpiredNotice";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import BookingPage from "./pages/BookingPage.tsx";
import BookingDetailsPage from "./pages/BookingDetailsPage.tsx";
import TradeInspectionRequestsPage from "./pages/TradeInspectionRequestsPage.tsx";
import TradeInspectionRequestCreatePage from "./pages/TradeInspectionRequestCreatePage.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

import { AppProviders } from "./components/AppProviders";

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AuthProvider>
          <Toaster />
          <AuthSessionExpiredNotice />
          <Sonner />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute requireSuperAdmin />}>
              <Route element={<AppProviders />}>
                <Route path="/admin" element={<Index />} />
              </Route>
            </Route>
            <Route element={<ProtectedRoute />}>
              <Route element={<AppProviders />}>
                <Route path="/" element={<Index />} />
                <Route path="/agent" element={<Index />} />
                <Route path="/dashboard" element={<Index />} />
                <Route path="/booking" element={<BookingPage />} />
                <Route path="/trade" element={<TradeInspectionRequestsPage />} />
                <Route path="/trade/create" element={<TradeInspectionRequestCreatePage />} />
                <Route path="/bookings/dashboard" element={<BookingDetailsPage />} />
                <Route path="/bookings/pending" element={<BookingDetailsPage />} />
                <Route path="/bookings/confirmed" element={<BookingDetailsPage />} />
                <Route path="/bookings/completed" element={<BookingDetailsPage />} />
                <Route path="/bookings/cancelled" element={<BookingDetailsPage />} />
                <Route path="/bookings/:id" element={<BookingDetailsPage />} />
              </Route>
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

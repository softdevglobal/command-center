import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FirebaseAuthProvider } from "@/integrations/firebase/FirebaseAuthProvider";
import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import BookingPage from "./pages/BookingPage.tsx";
import BookingDetailsPage from "./pages/BookingDetailsPage.tsx";
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
  <FirebaseAuthProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <AuthProvider>
            <Toaster />
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
  </FirebaseAuthProvider>
);

export default App;
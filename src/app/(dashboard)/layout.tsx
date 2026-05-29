"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { CommandPalette } from "@/components/search/command-palette";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen">
      <div data-print-hide>
        <Sidebar open={sidebarOpen} onOpenChange={setSidebarOpen} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div data-print-hide>
          <Header
            onMenuClick={() => setSidebarOpen(true)}
            onOpenSearch={() => setSearchOpen(true)}
          />
        </div>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

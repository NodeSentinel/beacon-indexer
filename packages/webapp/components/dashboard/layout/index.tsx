import type React from 'react';

interface DashboardPageLayoutProps {
  children: React.ReactNode;

  header: {
    title: string;
    description?: string;
    icon: React.ElementType;
  };
}

export default function DashboardPageLayout({ children, header }: DashboardPageLayoutProps) {
  return (
    <div className="flex flex-col relative w-full gap-1 min-h-full">
      <div className="flex items-center lg:items-baseline gap-2.5 md:gap-4 px-4 md:px-6 py-2.5 md:py-3 lg:pt-6 ring-2 ring-pop sticky top-header-mobile lg:top-0 bg-background z-10">
        <div className="max-lg:contents rounded bg-primary size-7 md:size-8 flex items-center justify-center my-auto">
          <header.icon className="ml-1 lg:ml-0 opacity-50 md:opacity-100 size-4 md:size-5" />
        </div>
        <h1 className="page-title leading-[1] mb-1">{header.title}</h1>
        {header.description && <span className="ml-auto text-helper">{header.description}</span>}
      </div>
      <div className="min-h-full flex-1 flex flex-col gap-6 md:gap-10 px-3 lg:px-6 py-4 md:py-8 ring-2 ring-pop bg-background">
        {children}
      </div>
    </div>
  );
}

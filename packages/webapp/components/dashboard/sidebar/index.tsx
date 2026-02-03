'use client';

import Image from 'next/image';
import * as React from 'react';

// Local minimal UI primitives to satisfy type-check without external UI module imports
function Sidebar(props: React.HTMLAttributes<HTMLElement>) {
  return <aside {...props} />;
}
function SidebarHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
function SidebarContent(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
function SidebarFooter(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
function SidebarGroup(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
function SidebarGroupLabel(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
function SidebarGroupContent(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
function SidebarMenu(props: React.HTMLAttributes<HTMLUListElement>) {
  return <ul {...props} />;
}
function SidebarMenuItem(props: React.LiHTMLAttributes<HTMLLIElement>) {
  return <li {...props} />;
}
function SidebarMenuBadge(props: React.HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} />;
}
function SidebarMenuButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    isActive?: boolean;
    asChild?: boolean;
  },
) {
  // ignore isActive/asChild for this minimal stub
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { isActive, asChild, ...rest } = props;
  return <button type="button" {...rest} />;
}
function SidebarRail(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
function Popover(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
function PopoverTrigger(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} />;
}
function PopoverContent(
  props: React.HTMLAttributes<HTMLDivElement> & {
    side?: string;
    align?: string;
    sideOffset?: number;
  },
) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { side, align, sideOffset, ...rest } = props;
  return <div {...rest} />;
}
import AtomIcon from '@/components/icons/atom';
import BracketsIcon from '@/components/icons/brackets';
import CuteRobotIcon from '@/components/icons/cute-robot';
import DotsVerticalIcon from '@/components/icons/dots-vertical';
import EmailIcon from '@/components/icons/email';
import GearIcon from '@/components/icons/gear';
import LockIcon from '@/components/icons/lock';
import MonkeyIcon from '@/components/icons/monkey';
import ProcessorIcon from '@/components/icons/proccesor';
import { Bullet } from '@/components/ui/bullet';
import { cn } from '@/lib/utils';
import { useIsV0 } from '@/lib/v0-context';

// This is sample data for the sidebar
const data = {
  navMain: [
    {
      title: 'Tools',
      items: [
        {
          title: 'Overview',
          url: '/',
          icon: BracketsIcon,
          isActive: true,
        },
        {
          title: 'Laboratory',
          url: '/laboratory',
          icon: AtomIcon,
          isActive: false,
        },
        {
          title: 'Devices',
          url: '/devices',
          icon: ProcessorIcon,
          isActive: false,
        },
        {
          title: 'Security',
          url: '/security',
          icon: CuteRobotIcon,
          isActive: false,
        },
        {
          title: 'Communication',
          url: '/communication',
          icon: EmailIcon,
          isActive: false,
        },
        {
          title: 'Admin Settings',
          url: '/admin',
          icon: GearIcon,
          isActive: false,
          locked: true,
        },
      ],
    },
  ],
  desktop: {
    title: 'Desktop (Online)',
    status: 'online',
  },
  user: {
    name: 'KRIMSON',
    email: 'krimson@joyco.studio',
    avatar: '/avatars/user_krimson.png',
  },
};

export function DashboardSidebar({ className, ...props }: React.ComponentProps<typeof Sidebar>) {
  const isV0 = useIsV0();

  return (
    <Sidebar {...props} className={cn('py-sides', className)}>
      <SidebarHeader className="rounded-t-lg flex gap-3 flex-row rounded-b-none">
        <div className="flex overflow-clip size-12 shrink-0 items-center justify-center rounded bg-sidebar-primary-foreground/10 transition-colors group-hover:bg-sidebar-primary text-sidebar-primary-foreground">
          <MonkeyIcon className="size-10 group-hover:scale-[1.7] origin-top-left transition-transform" />
        </div>
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="text-2xl font-display">M.O.N.K.Y.</span>
          <span className="text-xs uppercase">The OS for Rebels</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {data.navMain.map((group, i) => (
          <SidebarGroup className={cn(i === 0 && 'rounded-t-none')} key={group.title}>
            <SidebarGroupLabel>
              <Bullet className="mr-2" />
              {group.title}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem
                    key={item.title}
                    className={cn(
                      item.locked && 'pointer-events-none opacity-50',
                      isV0 && 'pointer-events-none',
                    )}
                    data-disabled={item.locked}
                  >
                    <SidebarMenuButton
                      asChild={!item.locked}
                      isActive={item.isActive}
                      disabled={item.locked}
                      className={cn(
                        'disabled:cursor-not-allowed',
                        item.locked && 'pointer-events-none',
                      )}
                    >
                      {item.locked ? (
                        <div className="flex items-center gap-3 w-full">
                          <item.icon className="size-5" />
                          <span>{item.title}</span>
                        </div>
                      ) : (
                        <a href={item.url}>
                          <item.icon className="size-5" />
                          <span>{item.title}</span>
                        </a>
                      )}
                    </SidebarMenuButton>
                    {item.locked && (
                      <SidebarMenuBadge>
                        <LockIcon className="size-5 block" />
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-0">
        <SidebarGroup>
          <SidebarGroupLabel>
            <Bullet className="mr-2" />
            User
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <Popover>
                  <PopoverTrigger className="flex gap-0.5 w-full group cursor-pointer">
                    <div className="shrink-0 flex size-14 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground overflow-clip">
                      <Image src={data.user.avatar} alt={data.user.name} width={120} height={120} />
                    </div>
                    <div className="group/item pl-3 pr-1.5 pt-2 pb-1.5 flex-1 flex bg-sidebar-accent hover:bg-sidebar-accent-active/75 items-center rounded group-data-[state=open]:bg-sidebar-accent-active group-data-[state=open]:hover:bg-sidebar-accent-active group-data-[state=open]:text-sidebar-accent-foreground">
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate text-xl font-display">{data.user.name}</span>
                        <span className="truncate text-xs uppercase opacity-50 group-hover/item:opacity-100">
                          {data.user.email}
                        </span>
                      </div>
                      <DotsVerticalIcon className="ml-auto size-4" />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-0" side="bottom" align="end" sideOffset={4}>
                    <div className="flex flex-col">
                      <button className="flex items-center px-4 py-2 text-sm hover:bg-accent">
                        <MonkeyIcon className="mr-2 h-4 w-4" />
                        Account
                      </button>
                      <button className="flex items-center px-4 py-2 text-sm hover:bg-accent">
                        <GearIcon className="mr-2 h-4 w-4" />
                        Settings
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

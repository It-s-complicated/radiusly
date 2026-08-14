/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/info" />

import type { auth } from '$lib/server/auth';

type AuthSession = typeof auth.$Infer.Session;

declare global {
	namespace App {
		interface Locals {
			session: AuthSession['session'] | null;
			user: AuthSession['user'] | null;
		}
	}
	interface BeforeInstallPromptEvent extends Event {
		prompt(): Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}

	interface Window {
		BeforeInstallPromptEvent: new () => BeforeInstallPromptEvent;
	}
}

export {};

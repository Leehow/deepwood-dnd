import { QueryClient } from "@tanstack/react-query";

function createDefaultQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1 * 60 * 1000,
        gcTime: 5 * 60 * 1000,
      },
    },
  });
}

let browserQueryClient: QueryClient | null = null;

export function getAppQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    return createDefaultQueryClient();
  }

  if (!browserQueryClient) {
    browserQueryClient = createDefaultQueryClient();
  }

  return browserQueryClient;
}

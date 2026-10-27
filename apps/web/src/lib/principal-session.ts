import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function usePrincipalSession() {
  return useQuery({
    queryKey: ['session'], queryFn: api.getSession,
    retry: false, staleTime: 15_000, refetchInterval: 30_000,
  });
}

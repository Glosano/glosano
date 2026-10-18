import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import {
  externalDictionariesApi,
  type CustomDictionaryPayload,
  type ExternalDictionaries,
  type ExternalDictionary,
} from '@/api/externalDictionaries'

export const externalDictionariesKey = (src: string, dst: string) =>
  ['external-dictionaries', src, dst] as const

export function useExternalDictionaries(
  src: string,
  dst: string,
): UseQueryResult<ExternalDictionaries> {
  return useQuery({
    queryKey: externalDictionariesKey(src, dst),
    queryFn: () => externalDictionariesApi.list(src, dst),
  })
}

export function useExternalDictionaryMutations(
  src: string,
  dst: string,
): {
  setLayout: UseMutationResult<ExternalDictionaries, Error, string[]>
  createCustom: UseMutationResult<ExternalDictionary, Error, CustomDictionaryPayload>
  updateCustom: UseMutationResult<
    ExternalDictionary,
    Error,
    { id: string; payload: CustomDictionaryPayload }
  >
  deleteCustom: UseMutationResult<void, Error, string>
} {
  const qc = useQueryClient()
  // A custom dictionary may be "for all languages", so any pair can change.
  const invalidateAll = () => qc.invalidateQueries({ queryKey: ['external-dictionaries'] })

  const setLayout = useMutation({
    mutationFn: (visible: string[]) => externalDictionariesApi.setLayout(src, dst, visible),
    onSuccess: (data) => {
      qc.setQueryData(externalDictionariesKey(src, dst), data)
    },
  })
  const createCustom = useMutation({
    mutationFn: (payload: CustomDictionaryPayload) => externalDictionariesApi.createCustom(payload),
    onSuccess: invalidateAll,
  })
  const updateCustom = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CustomDictionaryPayload }) =>
      externalDictionariesApi.updateCustom(id, payload),
    onSuccess: invalidateAll,
  })
  const deleteCustom = useMutation({
    mutationFn: (id: string) => externalDictionariesApi.deleteCustom(id),
    onSuccess: invalidateAll,
  })
  return { setLayout, createCustom, updateCustom, deleteCustom }
}

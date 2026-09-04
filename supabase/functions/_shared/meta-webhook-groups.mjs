// Agrupa os `changes[].value` de um webhook da Meta por phone_number_id antes
// de fundir mensagens/status.
//
// A Meta manda pro APP, não pra BM: duas contas de clientes diferentes
// conectadas no mesmo app podem ter evento entregue no MESMO POST (`entry[]`
// com mais de um item, um por número). Fundir tudo num objeto só sem separar
// por número primeiro pega o metadata de UM phone_number_id e processa as
// mensagens de todos como se fossem dele — mistura lead e conversa de conta
// pra conta. Aqui cada grupo nunca cruza phone_number_id diferente; dentro do
// grupo o merge é o mesmo de sempre (Meta pode legitimamente separar um
// change de mensagem e outro de status pro mesmo número).
export function groupChangesByPhoneNumber(changeValues) {
  const porNumero = new Map();
  for (const item of changeValues || []) {
    const chave = item?.metadata?.phone_number_id || "";
    const lista = porNumero.get(chave) || [];
    lista.push(item);
    porNumero.set(chave, lista);
  }

  const grupos = [];
  for (const grupo of porNumero.values()) {
    const value =
      grupo.length <= 1
        ? grupo[0]
        : {
            ...grupo[0],
            metadata:
              grupo.find((item) => item?.messages?.length && item?.metadata)?.metadata ||
              grupo.find((item) => item?.metadata)?.metadata ||
              null,
            contacts: grupo.flatMap((item) => item?.contacts || []),
            messages: grupo.flatMap((item) => item?.messages || []),
            statuses: grupo.flatMap((item) => item?.statuses || []),
          };
    if (value) grupos.push(value);
  }
  return grupos;
}

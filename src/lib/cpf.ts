/** Dígito verificador do CPF — barra número obviamente falso (111.111.111-11 etc.) na hora, sem round-trip ao servidor. */
export function cpfValido(cpf: string): boolean {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digitoVerificador = (len: number) => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += parseInt(d[i], 10) * (len + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digitoVerificador(9) === parseInt(d[9], 10) && digitoVerificador(10) === parseInt(d[10], 10);
}

export function maskCpf(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

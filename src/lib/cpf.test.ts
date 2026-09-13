// Check da validação de CPF do cadastro de teste grátis.
// Rodar: npm test
import { describe, expect, it } from "vitest";
import { cpfValido, maskCpf } from "./cpf";

describe("cpfValido", () => {
  it("aceita CPF real com pontuação ou só dígitos", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("52998224725")).toBe(true);
  });

  it("rejeita dígito verificador errado", () => {
    expect(cpfValido("529.982.247-26")).toBe(false);
  });

  it("rejeita todos os dígitos iguais (111.111.111-11 etc.)", () => {
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("00000000000")).toBe(false);
  });

  it("rejeita tamanho errado", () => {
    expect(cpfValido("123")).toBe(false);
    expect(cpfValido("")).toBe(false);
  });
});

describe("maskCpf", () => {
  it("formata progressivamente enquanto digita", () => {
    expect(maskCpf("529")).toBe("529");
    expect(maskCpf("52998224")).toBe("529.982.24");
    expect(maskCpf("52998224725")).toBe("529.982.247-25");
  });

  it("ignora dígito além do 11º", () => {
    expect(maskCpf("529982247259999")).toBe("529.982.247-25");
  });
});

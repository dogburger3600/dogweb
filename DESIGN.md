---
name: Dog Burger
description: Balcão Noturno — uma identidade gastronômica urbana, precisa e acolhedora.
colors:
  orange-signature: "#F97316"
  orange-deep: "#EA580C"
  night-charcoal: "#1C1917"
  night-raised: "#292524"
  stone-text: "#78716C"
  stone-muted: "#A8A29E"
  line-soft: "#E7E5E4"
  surface-soft: "#F5F5F4"
  canvas-warm: "#FAFAF9"
  white: "#FFFFFF"
  success: "#16A34A"
  information: "#2563EB"
  warning: "#D97706"
  danger: "#DC2626"
  auxiliary-violet: "#7C3AED"
typography:
  display:
    fontFamily: "Outfit, sans-serif"
    fontSize: "clamp(2rem, 5vw, 3rem)"
    fontWeight: 900
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Outfit, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.15
  title:
    fontFamily: "Outfit, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Nunito, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "Nunito, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.05em"
  numeric:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "0.8rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  compact: "8px"
  control: "10px"
  standard: "12px"
  card: "14px"
  product: "16px"
  feature: "18px"
  dialog: "20px"
  auth: "24px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.orange-signature}"
    textColor: "{colors.white}"
    typography: "{typography.title}"
    rounded: "{rounded.standard}"
    padding: "13px 18px"
  button-primary-hover:
    backgroundColor: "{colors.orange-deep}"
    textColor: "{colors.white}"
    rounded: "{rounded.standard}"
  button-secondary:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.stone-text}"
    typography: "{typography.title}"
    rounded: "{rounded.standard}"
    padding: "13px 18px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.night-charcoal}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.night-charcoal}"
    rounded: "{rounded.card}"
    padding: "18px 20px"
  navigation-dark:
    backgroundColor: "{colors.night-charcoal}"
    textColor: "{colors.stone-muted}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  chip:
    backgroundColor: "{colors.white}"
    textColor: "{colors.stone-text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 16px"
---

# Design System: Dog Burger

## Overview

**Creative North Star: "Balcão Noturno"**

Balcão Noturno traduz o Dog Burger como uma hamburgueria urbana vista no melhor momento da noite: carvão profundo, luz quente e serviço preciso. A identidade é moderna, minimalista, elegante e profissional. O logotipo oficial e a fotografia real dos produtos carregam personalidade; a interface cria enquadramento e ritmo sem competir com eles.

A experiência do cliente é marcante e acolhedora, com contraste forte, composição direta e laranja como sinal de ação. O painel administrativo é predominantemente claro, com navegação escura e acentos laranja, favorecendo leitura prolongada, organização e eficiência operacional. Camadas são sutis, componentes são contidos e a hierarquia é precisa.

**Key Characteristics:**
- Preto carvão, laranja quente e branco como assinatura dominante.
- Superfícies claras e calmas para leitura e operação.
- Contraste alto, tipografia limpa e hierarquia inequívoca.
- Profundidade ambiental discreta, reservada a elementos realmente elevados.
- Ícones SVG consistentes no lugar de emojis de interface.
- Movimento curto e funcional, sempre respeitando redução de movimento.

## Colors

A paleta combina a atmosfera noturna da marca com superfícies quentes e claras; cores semânticas aparecem somente quando comunicam estado operacional.

### Primary
- **Laranja de Brasa:** ação principal, seleção, preço e progresso. Deve ser raro o suficiente para conservar autoridade.
- **Laranja Tostado:** hover, texto de destaque sobre superfícies claras e estados que exigem contraste maior.

### Secondary
- **Carvão da Noite:** cabeçalhos, navegação, hero e superfícies de alta autoridade.
- **Carvão Elevado:** seleção e hover dentro de superfícies escuras.

### Tertiary
- **Verde de Operação:** sucesso e disponibilidade.
- **Azul de Informação:** informação neutra e conectividade.
- **Âmbar de Atenção:** alertas que ainda permitem continuidade.
- **Vermelho de Interrupção:** erro, cancelamento e ação destrutiva.
- **Violeta Auxiliar:** uso excepcional em ferramentas internas existentes; não integra a assinatura principal.

### Neutral
- **Pedra de Leitura:** texto secundário em superfícies claras.
- **Pedra Silenciosa:** metadados e texto auxiliar quando o contraste continuar acessível.
- **Linha Suave:** divisores e bordas discretas.
- **Superfície Suave:** controles secundários e agrupamentos.
- **Tela Quente:** fundo geral das áreas claras.
- **Branco de Serviço:** cartões, modais e áreas de leitura.

### Named Rules

**The Ember Signal Rule.** O laranja indica ação, seleção ou informação prioritária; não funciona como preenchimento decorativo recorrente.

**The Light Workbench Rule.** O painel administrativo permanece predominantemente claro; superfícies escuras ficam concentradas na navegação e em momentos de marca.

**The Contrast Before Character Rule.** Nenhuma combinação de marca justifica texto com contraste insuficiente; tons mais escuros devem assumir o texto quando necessário.

## Typography

**Display Font:** Outfit (com fallback sans-serif)  
**Body Font:** Nunito (com fallback sans-serif)  
**Label/Mono Font:** JetBrains Mono (com fallback monospace)

**Character:** Outfit dá confiança e presença compacta a títulos, preços e indicadores. Nunito mantém leitura acolhedora e clara. JetBrains Mono organiza valores, códigos e dados operacionais sem invadir textos comuns.

### Hierarchy
- **Display** (900, fluido de 2rem a 3rem, 1.1): títulos de hero e raros momentos de marca.
- **Headline** (800, 1.5rem, 1.15): títulos de página, modal e blocos principais.
- **Title** (700, 1rem, 1.3): nomes de produtos, cartões e agrupamentos.
- **Body** (500, 0.95rem, 1.5): descrições, instruções e conteúdo contínuo; linhas devem permanecer confortáveis, idealmente abaixo de 70 caracteres.
- **Label** (700, 0.8rem, 0.05em, maiúsculas quando necessário): campos, estados e metadados curtos.
- **Numeric** (500, 0.8rem, 1.4): valores tabulares, horários, identificadores e totais auxiliares.

### Named Rules

**The One Loud Voice Rule.** Cada janela possui um único título dominante; peso 900 não se repete em rótulos, botões e cartões.

**The Readable Counter Rule.** Informações operacionais nunca dependem de texto excessivamente pequeno; legibilidade prevalece sobre densidade.

## Layout

A composição usa uma escala baseada em múltiplos de 4px, com ritmo recorrente de 8px, 12px, 16px, 20px, 24px e 32px. A área do cliente trabalha com contêiner central de até 1200px e grade fluida de produtos. O painel usa navegação lateral fixa de 240px em desktop, reduzida a 200px em telas intermediárias, e navegação inferior em até 640px.

No cliente, o primeiro quadro deve estabelecer marca e conduzir rapidamente ao cardápio; imagem real e ação têm precedência sobre decoração. No painel, a grade privilegia leitura sequencial: contexto e estado, indicadores, tarefa principal e detalhes. Em mobile, conteúdo vira uma coluna quando duas colunas comprometerem a leitura; controles críticos permanecem visíveis e com alvo mínimo confortável.

**The Window Consistency Rule.** Cada janela pode ajustar densidade ao trabalho realizado, mas compartilha os mesmos tokens, componentes, estados e comportamento responsivo.

**The Product Leads Rule.** No cardápio, fotografia real, nome, preço e ação formam a hierarquia principal; ornamento nunca disputa atenção com o produto.

## Elevation & Depth

O sistema usa camadas sutis. Bordas e contraste tonal resolvem a maior parte da separação; sombras ambientais aparecem em cartões interativos, drawers, modais e superfícies realmente elevadas. A profundidade é funcional e não um acabamento aplicado indiscriminadamente.

### Shadow Vocabulary
- **Interação suave** (`0 12px 40px rgba(0,0,0,0.10)`): elevação breve de cartão interativo.
- **Navegação lateral** (`8px 0 28px rgba(28,25,23,0.08)`): separação discreta entre navegação e área de trabalho.
- **Drawer** (`-8px 0 40px rgba(0,0,0,0.15)`): painel temporário acima do conteúdo.
- **Modal** (`0 24px 80px rgba(0,0,0,0.20)`): diálogo que exige foco imediato.

**The Flat Workbench Rule.** Superfícies operacionais ficam planas em repouso; sombra aparece apenas quando comunica hierarquia, interação ou sobreposição.

## Shapes

O vocabulário é suavemente arredondado: 8–10px em controles compactos, 12px em botões e grupos, 14–18px em cartões e 20–24px em diálogos e autenticação. Pílulas ficam restritas a filtros, badges e estados curtos. Bordas são finas e claras; recortes preservam fotografias e conteúdo real.

**The Contained Curve Rule.** Arredondamento transmite acabamento e acessibilidade sem transformar todos os elementos em cápsulas.

## Components

### Buttons
- **Shape:** cantos contidos de 10–12px.
- **Primary:** laranja de assinatura, texto claro, tipografia Outfit em peso 700 e padding vertical de 13px.
- **Hover / Focus:** hover escurece para laranja tostado; foco deve usar anel claramente visível e não depender apenas de cor.
- **Secondary / Ghost:** superfícies neutras para ações secundárias e tratamento transparente em barras escuras.

### Chips
- **Style:** cápsulas de borda suave, fundo branco e texto secundário.
- **State:** seleção usa laranja com contraste acessível; badges semânticos usam apenas a cor correspondente ao estado real.

### Cards / Containers
- **Corner Style:** 14px para cartões operacionais, 16px para produtos e 18px para cartões de destaque.
- **Background:** branco sobre tela quente; carvão somente quando a função pede autoridade de marca.
- **Shadow Strategy:** planos em repouso; elevação suave apenas em hover ou sobreposição.
- **Border:** linha clara entre 1px e 1.5px.
- **Internal Padding:** 16–24px conforme densidade.

### Inputs / Fields
- **Style:** fundo branco, borda de 1.5px, raio de 10px e padding de 10px por 14px.
- **Focus:** borda laranja acompanhada de foco visível.
- **Error / Disabled:** erro usa vermelho com mensagem textual; desabilitado usa superfície suave e mantém legibilidade.

### Navigation
- Navegação principal escura com texto silencioso e seleção em carvão elevado com acento laranja. No painel desktop, a navegação é lateral; no mobile, deve preservar descoberta, rótulos legíveis e acesso a todos os destinos sem depender de itens cortados.

### Product Card
- Fotografia real em proporção 4:3, nome e preço com autoridade tipográfica, descrição secundária e ação laranja contida. Indisponibilidade é comunicada por texto e estado, nunca apenas por opacidade.

### Operational Card
- KPIs e pedidos usam superfícies claras, borda sutil e hierarquia numérica. Cor semântica indica estado; não colore todo o cartão sem necessidade.

## Do's and Don'ts

### Do:
- **Do** preserve o logotipo oficial e use fotografia autêntica dos produtos.
- **Do** concentre o preto em navegação, hero e momentos de marca.
- **Do** mantenha o painel predominantemente claro e confortável para uso prolongado.
- **Do** use laranja para ação, seleção, preço e progresso.
- **Do** use SVGs profissionais com tamanho e traço consistentes.
- **Do** mantenha componentes contidos, hierarquia precisa e alvos de interação confortáveis.
- **Do** ofereça redução de movimento e foco de teclado visível.

### Don't:
- **Don't** use emojis como ícones de interface.
- **Don't** fabrique fotografias ou substitua imagens reais por ilustrações genéricas.
- **Don't** acumule gradientes, sombras ou superfícies decorativas.
- **Don't** transforme o painel em uma interface predominantemente escura.
- **Don't** use laranja como preenchimento amplo sem função.
- **Don't** introduza novos padrões visuais por janela quando um componente compartilhado resolver o caso.
- **Don't** comprometa contraste, leitura ou usabilidade em nome da atmosfera.

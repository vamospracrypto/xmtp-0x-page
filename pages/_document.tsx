// pages/_document.tsx
import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="pt-BR">
      <Head>
        {/* Favicon principal */}
        <link rel="icon" href="/favicon-vamos.png" />

        {/* Se quiser adicionar tamanhos diferentes */}
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-vamos.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-vamos.png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}

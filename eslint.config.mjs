import next from 'eslint-config-next'

const config = [
  { ignores: ['.next/**', '.open-next/**', '.wrangler/**', 'node_modules/**', 'drizzle/**'] },
  ...next,
]

export default config

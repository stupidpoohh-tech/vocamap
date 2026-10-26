import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typedRoutes: false,
  // 서버 액션이 하나도 없다. 고치는 일이 전부 브라우저에서 끝나므로 서버로
  // 보낼 것이 없고, `/api/health` 도 함께 사라졌다 — 물어볼 데이터베이스가
  // 없는데 "데이터베이스가 답하나"를 묻는 화면이었다.
}

export default nextConfig

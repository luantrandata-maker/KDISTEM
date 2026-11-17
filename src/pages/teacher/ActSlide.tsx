// Khung chơi hoạt động trên slide (tải riêng khi slide hoạt động hiện ra): dùng đúng trình chơi của bài giảng tương tác
import { useMemo } from 'react'
import { BlockView } from '../../lib/lessonBlocks'
import { activityToBlock, type ActKind } from './activity'
import type { KhoAct } from './Lessons'

export default function ActSlide({ act }: { act: KhoAct }) {
  const b = useMemo(() => activityToBlock({ kind: act.kind as ActKind, title: act.title, content: act.content, instructions: null }), [act.id, act.updated_at, act.kind])
  return <BlockView b={b} teacher slide />
}

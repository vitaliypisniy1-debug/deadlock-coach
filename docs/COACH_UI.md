# Экран «Тренер»: контракт разметки

Стили готовы в `src/renderer/theme.css` (раздел «Экран «Тренер»», классы `tc-*`). Данные и логика остаются у сессии «Тренер»: нужно собрать разметку функциями экрана так, как ниже. Цвета, шрифты и отступы не задавать, брать только эти классы и общие `.btn`, `.pill`, `.note`, `.empty`, `.panel`.

```
section.tc-main                         главная цель
  div.tc-head
    span.tc-area              область (g.area)
    span.tc-step              «ступень 2 из 3» (если есть g.ladderInfo)
    span.tc-spacer
    button.btn.small          «Сменить цель»
  h2.tc-title                 g.title
  p.tc-ladder                 «Сначала легче, потом …» (если есть ladderInfo)
  div.tc-heroes               чипы героев планки g.byHero (.pill)
  div.tc-label                «Игры после старта цели» / «Так было до старта цели»
  div.tc-ribbon
    button.tc-game(.pass|.fail|.none)(.before)   по плитке на игру; .before: игра до старта цели
      heroIcon()  span.tc-val (значение g.rows[].text)  span.tc-mark («✓ выполнено» / «✕ не выполнено» / «нет данных»)
  div.tc-progress
    div.tc-bar > span[style=width:%]     полоса g.rate
    div (подпись «игр выполнено после старта»)   div.tc-count «3<small>из 6</small>»
  div.tc-facts                факты через <span><b>…</b> текст</span>: «закроется, когда…», серия, лучшая серия, «обычно было → сейчас», «до старта…» (только при priorGames >= 5, иначе .pill.low «мало данных»)
  div.tc-stuck                предупреждение g.stuck
  div.tc-why
    h3 «Почему эта цель»
    ul > li.episode|.stat|.compare|.link   g.why.lines
    div.tc-why-note           g.why.note
    button.btn.small          «Показать на карте · время» (если g.evidence)
  div.tc-cols
    div.tc-col > h3 «Что делать» + p (g.act)
    div.tc-col > h3 «Как проверим» + p (g.how)

div.tc-spares                           до двух запасных целей
  div.tc-spare
    span.tc-area, h3.tc-spare-title, span.tc-step, div.tc-dots > i.pass|.fail (✓ / ✕),
    p.muted «N из M игр выполнено · обычно …, у топов …», div.tc-stuck (если stuck), p (g.act), button.btn.small «Сменить»

div.tc-done                             выполненные
  div.tc-done-item: Icon('circle-check'), div(b название, span «Было … → стало … · выполнено в N из M игр»), span.muted дата

details.tc-details > summary «Подробности по играм» + .gcards (как сейчас)
```

Состояния: загрузка, ошибка, мало данных, нет активных целей, не вошёл в Steam: общие `.empty`, `.note`, `skeleton()`. «Мало данных» внутри цели: `.pill.low`.
Убраны: кольцо процента, плитки «целей закрыто / игр разобрано», «План до …», «Сообщения тренера», «Прошлые цели».

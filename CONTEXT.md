# Douyin Live Room Moderator Assistant

This context defines the language for a tool that helps operate a Douyin live room.

## Language

**Moderator Assistant**:
A tool that helps a live room operator monitor audience activity and perform routine engagement actions.
_Avoid_: Moderator permission manager, admin manager

**Live Room**:
A Douyin live broadcast space where viewers generate activity and the operator can send engagement actions.
_Avoid_: Room, channel

**Active Live Room**:
The **Live Room** currently being operated by the person using the **Moderator Assistant**.
_Avoid_: Target room, configured room

**Interaction Feed**:
The visible activity stream in an **Active Live Room** where audience activity appears.
_Avoid_: Network feed, protocol stream

**Live Event**:
An audience or platform activity observed from the **Interaction Feed**.
_Avoid_: Message, notification, packet

**Event Fingerprint**:
A temporary identity used to recognize the same **Live Event** within one page session.
_Avoid_: Event ID, user ID

**Engagement Action**:
A non-punitive operator action sent into an **Active Live Room** to support routine audience engagement.
_Avoid_: Management action, moderation action, enforcement action

**Barrage Reply**:
A viewer-visible text response sent into an **Active Live Room**.
_Avoid_: Comment, chat message

**Room Like**:
A like sent to the **Active Live Room** by the operator.
_Avoid_: Like event, reaction

**Browser Login State**:
The Douyin account state already present in the user's current browser session.
_Avoid_: Stored credentials, extension login

**Automation Rule**:
A configured rule that may create a **Barrage Reply** when a matching **Live Event** appears.
_Avoid_: Auto-response rule, script

**Trigger**:
The kind of **Live Event** that an **Automation Rule** watches for.
_Avoid_: Condition type

**Trigger Support**:
The assistant's current ability to recognize a **Trigger** from the **Interaction Feed**.
_Avoid_: Feature status, parser status

**Match Pattern**:
The text or gift name an **Automation Rule** uses to narrow which **Live Events** qualify.
_Avoid_: Filter, keyword

**Reply Template**:
The reusable text pattern an **Automation Rule** turns into a **Barrage Reply**.
_Avoid_: Response content, message body

**Template Variable**:
A placeholder in a **Reply Template** that is replaced with data from the triggering **Live Event**.
_Avoid_: Macro, shortcode

**Cooldown**:
The minimum time before the same **Automation Rule** may create another **Barrage Reply**.
_Avoid_: Delay, interval

**Send Queue**:
The ordered buffer that spaces out pending **Barrage Replies** before they are sent.
_Avoid_: Message queue, retry queue

**Send Guard**:
A basic safety check that prevents obviously invalid or repetitive **Barrage Replies** from being sent.
_Avoid_: Content moderation, sensitive word filter

**Scheduled Action**:
A recurring **Engagement Action** created according to elapsed time rather than a **Live Event**.
_Avoid_: Timed rule, always rule

**Assistant Profile**:
The saved set of rules and preferences used by the **Moderator Assistant** for the browser user.
_Avoid_: Room profile, cloud profile

**Session Log**:
The temporary record of **Live Events** and assistant activity for the current page session.
_Avoid_: History, audit log

**Run Session**:
The period during which the **Moderator Assistant** is actively allowed to create **Engagement Actions** in the current page session.
_Avoid_: Enabled profile, saved state

**Paused Session**:
A page session where the **Moderator Assistant** observes activity but is not allowed to create **Engagement Actions**.
_Avoid_: Disabled profile, stopped extension

**Enforcement Action**:
An action that restricts an audience member or changes a room role.
_Avoid_: Engagement action

## Relationships

- A **Moderator Assistant** operates against exactly one **Active Live Room** at a time.
- An **Active Live Room** is a **Live Room**.
- An **Active Live Room** exposes one **Interaction Feed**.
- An **Interaction Feed** contains many **Live Events**.
- A **Live Event** has one **Event Fingerprint** within a page session.
- A **Live Event** may trigger one **Barrage Reply**.
- An **Automation Rule** has one **Trigger**, one **Reply Template**, and one **Cooldown**.
- A **Trigger** has one **Trigger Support** status for the current page adapter.
- An **Automation Rule** may have one **Match Pattern**.
- A **Reply Template** may contain **Template Variables** for user, gift, count, and content.
- An **Assistant Profile** contains many **Automation Rules**.
- An **Assistant Profile** may contain many **Scheduled Actions**.
- A **Moderator Assistant** relies on the **Browser Login State**.
- A **Moderator Assistant** maintains one **Session Log** per page session.
- A **Run Session** belongs to one page session.
- A **Paused Session** belongs to one page session.
- An **Automation Rule** can create **Barrage Replies** only during a **Run Session**.
- A **Scheduled Action** can create **Engagement Actions** only during a **Run Session**.
- A **Barrage Reply** passes through the **Send Queue** before it is sent.
- A **Barrage Reply** must pass a **Send Guard** before it is sent.
- A **Room Like** is an **Engagement Action**.
- A **Moderator Assistant** does not perform **Enforcement Actions**.

## Example dialogue

> **Dev:** "Should the **Moderator Assistant** assign or remove Douyin room admins?"
> **Domain expert:** "No. In this product, the assistant helps with routine engagement, not moderator permission management."

## Flagged ambiguities

- "房管管理" could mean either managing moderator permissions or assisting a room moderator; resolved: this product means **Moderator Assistant**.
- "直播间号" could imply choosing a separate target room inside the assistant; resolved: the assistant operates on the **Active Live Room**.
- "事件监听" could mean reading visible room activity or decoding a lower-level protocol stream; resolved: the assistant observes the **Interaction Feed**.
- "管理动作" could mean routine engagement or punitive moderation; resolved: the assistant performs **Engagement Actions**, not **Enforcement Actions**.
- "登录" could mean extension-owned account management or the browser's existing Douyin session; resolved: the assistant relies on **Browser Login State**.
- "设置" could mean per-room configuration or browser-user configuration; resolved: saved rules and preferences form one **Assistant Profile** for the browser user.
- "日志" could mean durable history or temporary activity visibility; resolved: the assistant keeps a **Session Log** for the current page session.
- "启用" could mean a saved rule is active or the assistant is currently running; resolved: saved rule state is distinct from a **Run Session**.
- "定时弹幕" could be modeled as a rule without an event; resolved: time-based behavior is a **Scheduled Action**, not an **Automation Rule**.

-- Restore telegram channels deleted during mistaken Basic-plan enforcement.
-- Run AFTER subscriptions.plan is Advanced (channel limit trigger).
-- Original row ids preserved so any remaining FKs can be re-pointed later.

INSERT INTO public.telegram_channels (
  id, user_id, channel_id, channel_username, display_name, is_active, created_at, updated_at
) VALUES
  ('941f3d38-33e0-4f0c-8899-4a8baba9550d', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1002007924246', '', '𝙎𝙄𝙂𝙈𝘼 𝙌𝙐𝙊𝙏𝙀𝙓 𝙏𝙍𝘼𝘿𝙄𝙉𝙂 (𝙎𝙌𝙏)', true, '2026-07-25 04:17:05.518827+00', now()),
  ('55922a04-5032-4726-b63b-de61b44f96fb', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1001680297592', '', 'GOLD EMPIRE', true, '2026-07-25 04:25:51.673911+00', now()),
  ('46cc7ae3-f1ef-44da-9f58-c10f8e493382', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1001566049294', 'EarnwithRashidChannel', 'Earn with Rashid', true, '2026-07-25 04:42:39.913864+00', now()),
  ('b3aac1a2-ac1c-4fc5-b371-68a284768849', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1001604309645', '', 'James Gold Master', true, '2026-07-25 05:11:07.020881+00', now()),
  ('f5097baf-d19b-4bf8-9739-c667c2c6093c', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1002176701424', 'unitedkings1', 'United Kings™ Signals! 👑', true, '2026-07-25 17:35:30.584069+00', now()),
  ('2b3f483b-f9d3-4bf1-9dca-8c38130eeb3d', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1001821216397', 'pipxpert', 'PipXpert - Forex Signals', true, '2026-07-25 20:22:21.827429+00', now()),
  ('2632635a-6e5e-490e-bf6a-5958d7c3139c', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1001230054900', 'mmsignalsfx', 'Market Makers', true, '2026-07-25 20:33:50.952212+00', now()),
  ('923fac43-1b9c-4f35-9272-f31f34e772a9', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1002729134234', 'BoomingbullsIndianMarket', 'Boomingbulls Indian Market', true, '2026-07-25 20:44:41.333116+00', now()),
  ('7e5b21ee-d513-488c-a3fa-e5fc916bc7fd', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1001758700941', '', 'Forexero - Forex Signals', true, '2026-07-25 21:34:10.115229+00', now()),
  ('335fdd3b-c208-403c-a589-b2aca2737118', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1001485556871', 'forexgoldbox12333', 'FOREX GOLD BOX ™️', true, '2026-07-25 21:43:40.768515+00', now()),
  ('393bd0c2-60b3-4142-9a33-4998e85a5b81', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1001785197109', '', '🌸AnabelSignals🌸 Best Free Forex & Gold Signals', true, '2026-07-25 22:16:06.251221+00', now()),
  ('010bc078-b300-4524-8cab-2f71afa26113', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1001485077759', 'prosignalsfxx', 'ProSignalsFx(Gold And Forex)', true, '2026-07-25 22:40:41.398073+00', now()),
  ('15bd0c74-e4a5-4fd2-895a-c45826bd5389', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1002004790807', 'XAUUSD_TRADES_CLUB', '𝙓𝘼𝙐/𝙐𝙎𝘿 𝙏𝙍𝘼𝘿𝙀𝙎 𝘾𝙇𝙐𝘽', true, '2026-07-28 03:15:09.231527+00', now()),
  ('71da9dd8-5393-4a7f-93e3-5c882462cca0', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1001597010642', 'SuccessForexSignals', 'Success Forex Signals', true, '2026-07-28 03:21:42.581673+00', now()),
  ('962d02a6-8fe3-4af1-8180-75d765f824b5', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1001838220681', 'goldprotradertame', '𝗚𝗢𝗟𝗗 𝗣𝗥𝗢 𝗧𝗥𝗔𝗗𝗘𝗥', true, '2026-07-28 03:50:43.198861+00', now()),
  ('f2d7d9ef-8332-4166-9355-869dc37c501b', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1002181524837', 'PipTargetSignal', 'PipTarget - Forex Signals', true, '2026-07-28 03:59:42.269027+00', now()),
  ('47e3590d-395f-4645-b5ed-97907883595a', 'c8a32918-9d96-4478-9869-a9e9cb1eccb1', '-1003974361863', '', 'Saif Rehman | Market Desk', true, '2026-07-29 04:40:01.673265+00', now())
ON CONFLICT (id) DO UPDATE SET
  is_active = EXCLUDED.is_active,
  channel_username = EXCLUDED.channel_username,
  display_name = EXCLUDED.display_name,
  updated_at = now();

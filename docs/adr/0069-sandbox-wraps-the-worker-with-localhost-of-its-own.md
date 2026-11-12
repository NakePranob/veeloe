# sandbox ครอบทั้ง worker ให้ Agent มี localhost ของตัวเอง และออกนอกได้ผ่าน supervisor เท่านั้น

> แก้ ADR 0008, 0020, 0029 และ 0068 บางส่วน ตามที่เขียนไว้ในหัวของแต่ละตัว

Agent ต้องทำงาน dev ได้จริง คือรัน dev server กับฐานข้อมูลแล้วยิงทดสอบเอง ลง package และ push งาน แต่ต้องแตะได้แค่ขอบเขตของตัวเอง sandbox ที่ทำอยู่ตอนนี้ไม่ตอบทั้งสองข้อ บน macOS อ่านได้ทั้งเครื่อง ยกเว้นรายชื่อไฟล์ลับ (`~/Develop` ของเจ้าของจึงยังอ่านได้) และ `(deny network*)` กัน localhost ไปด้วย บน Linux ออกเน็ตไม่ได้เลย และ worker ยังอยู่นอก sandbox ทั้งสองระบบ เราเทียบทางของ Claude Code, Codex, Cursor, Goose, OpenClaw และ sandbox บน cloud แล้ว (รายงาน research พ.ย. 2026) ผลิตภัณฑ์ที่รันบนเครื่องผู้ใช้ทุกตัวใช้ OS sandbox บวก proxy ที่อยู่นอก sandbox ไม่มีตัวไหนบังคับ Docker เราจึงใช้ทางเดียวกัน แต่ปิดจุดที่เขาเปิดไว้ แล้วแบ่งเป็นสามชั้น

**ชั้น 1 (ค่าเริ่มต้นของทุก Agent):**

- **sandbox ครอบ worker ทั้งโปรเซส** ตามเป้าของ ADR 0008 tool อ่านเขียนไฟล์และคำสั่งลูกอยู่ใต้กฎชุดเดียวที่ OS บังคับ ช่อง symlink และจังหวะว่างระหว่างตรวจ path กับเปิดไฟล์จึงหายไป การตรวจ path ของ tool เก็บไว้เป็นชั้นสำรอง ข้อที่เคยเขียนว่า Rust binary abort ใต้ `sandbox-exec` ยังไม่ยืนยัน เพราะลองบน macOS 27 แล้ว `veeloe worker` ขึ้น ready ได้ทั้งกับ profile เดิมและแบบ allow-list ต้องลองให้ครบหนึ่ง Turn ก่อนเปิดใช้
- **การอ่านเป็น allow-list** ตาม ADR 0068 อ่านได้แค่ system path, toolchain และ bin ของ Runtime เป็นแบบอ่านอย่างเดียว ส่วนโฟลเดอร์ของ Agent กับ Project และ Library ที่ Turn นั้นได้ เข้าถึงตามสิทธิ์ worker ใช้ home จำลอง `.home/` ในโฟลเดอร์ของ Agent ไม่มีรายชื่อไฟล์ลับอีก เพราะสิ่งที่ไม่ได้เปิดไว้มองไม่เห็นอยู่แล้ว
- **Task log อยู่นอกส่วนที่คำสั่งเขียนได้** worker ที่ถูกครอบแล้วกับคำสั่งลูกได้สิทธิ์เท่ากัน ถ้า log อยู่ในโฟลเดอร์ที่เขียนได้ คำสั่งที่โดน prompt injection ก็แก้ประวัติได้ supervisor จึงเป็นคนเขียน log และ worker ส่ง event ไปทาง stdio ส่วนที่คำสั่งเขียนได้เหลือ `workdir/`, `tmp/` และ `.home/`
- **localhost ของ Agent เอง** บน Linux worker อยู่ใน network namespace ว่างของตัวเอง มี `lo` ที่ไม่มีใครเห็น รัน dev server, Postgres และ Redis ที่ port ไหนก็ได้ บน macOS ไม่มี namespace และ Seatbelt รับช่วง port ใน rule ไม่ได้ Runtime จึงแบ่งช่วง port ไม่ซ้ำกันให้แต่ละ Agent แล้วเขียน rule ทีละ port พร้อมใส่ค่า `PORT` ให้ service ของเจ้าของเครื่องอยู่นอกช่วงจึงต่อไม่ได้
- **ออกนอกได้ทางเดียวคือ proxy ของ supervisor** บน Linux ใช้ Unix socket ที่ bind เข้า namespace แล้ว worker เป็นตัวส่งต่อเอง ไม่ต้องใช้ socat บน macOS เปิดให้ต่อแค่ port ของ proxy ตัวนั้น proxy resolve DNS เองแล้วต่อไปที่ IP นั้นตรงๆ ทิ้งที่อยู่ภายใน และตรวจว่า SNI ตรงกับ host ไม่ถอดรหัส TLS และ UDP ออกไม่ได้
- **ถ้า sandbox เริ่มไม่ได้ Turn นั้นไม่เริ่ม** ไม่มีทางถอยไปรันโดยไม่มี sandbox หรือไปใช้ Landlock อย่างเดียวโดยไม่บอก

**proxy ต่อ Turn และ git broker:** supervisor เปิด proxy ให้แต่ละ Turn proxy จึงรู้ว่าคำขอทำในนามของใคร (ADR 0010) โดยไม่ต้องเชื่อสิ่งที่ worker บอก ขอบเขตของ Turn คือสิ่งที่ Agent ได้รับ ซ้อนกับสิ่งที่คนส่งข้อความมีสิทธิ์ ใช้ทั้งกับ Project, Library และ Connector ส่วน Egress ใช้ค่าของ Agent ซึ่งแยกต่อ Agent ตั้งแต่ตอนนี้ (ADR 0029) เพราะเมื่อ proxy แยกต่อ Turn แล้ว รายชื่อกลางของ Machine ไม่ได้ทำให้อะไรง่ายขึ้น โดเมนใหม่ขอ Approval บนมือถือ และ credential ที่ผูกกับโดเมน proxy เป็นคนใส่ header ให้ Agent ไม่เห็นค่าจริง `git` ผ่าน broker ใน supervisor ซึ่งตรวจ repo กับ branch ของงาน และใช้ token สั้นๆ เช่น GitHub App installation token ที่หมดอายุใน 1 ชั่วโมงและจำกัดราย repo

**browser:** Agent รัน headless Chromium ใน sandbox ของตัวเองด้วย profile ใหม่ในโฟลเดอร์ของ Agent จึงเปิด localhost ของตัวเองได้ และออกเว็บข้างนอกผ่าน proxy เว็บที่ต้อง login ในนามของ Member ต้องใช้เป็น Connector ที่ supervisor ถือ session ไว้ และการกระทำที่ส่งผลจริงต้องขอ Approval ห้าม Agent ใช้ browser profile ของเจ้าของเครื่อง เพราะเท่ากับได้ทุก session ที่เจ้าของ login ไว้

**ชั้น 2 (Owner เปิดให้ Agent ทีละตัว):** VM ต่อ Agent ใช้ Apple `container` บน macOS 26 ขึ้นไป และ libkrun หรือ Firecracker บน Linux ที่มี `/dev/kvm` สำหรับงานที่ต้องการ Docker หรือการแยกแบบ VM VM ไม่มี NIC และคุยกับ supervisor ผ่าน vsock อย่างเดียว proxy, broker และ policy ชุดเดิมจึงใช้ได้เหมือนชั้น 1 ชั้นนี้ยังไม่เปิดให้ลูกค้าจนกว่าจะพิสูจน์ได้ว่า VM ที่ไม่มี NIC ทำงานได้จริง

**ชั้น 3 (build แอป Apple):** build iOS ทำในชั้น 1 ไม่ได้ เพราะ service ของ CoreSimulator รันนอก sandbox และ Apple ให้รัน macOS VM ได้แค่ 2 ตัวต่อเครื่อง Agent จึงส่ง build เป็นงานให้ supervisor ซึ่งส่งต่อไป EAS Build เป็นค่าเริ่มต้น หรือรัน `xcodebuild` บนเครื่องเป็นงานที่ supervisor คุม ไม่ได้เปิด shell บน macOS ของเครื่องให้ Agent

**ทรัพยากร:** Linux ใช้ cgroup v2 scope ต่อ Agent ผ่าน systemd ฝั่ง user ส่วน macOS ไม่มี cgroups จึงใช้ `RLIMIT_CPU` และให้ supervisor ฆ่า worker ที่ใช้ RAM เกินกำหนด ซึ่งเป็นแค่แบบอ่อน ถ้าต้องการเพดานจริงให้ใช้ชั้น 2

## Considered Options

- **Docker หรือ Podman เป็นข้อบังคับแบบ OpenClaw**: งาน dev สะดวกที่สุด แต่บน Mac ต้องมี Docker Desktop หรือ OrbStack ใช้ toolchain ของ macOS ไม่ได้เลย และ docker socket เท่ากับสิทธิ์ root ของเครื่อง เราจึงเหลือไว้เป็นชั้น 2 ที่เป็น VM แทน
- **รันทุก Agent บน cloud sandbox (E2B, Daytona, Modal)**: แยกขาดดี แต่ขัดกับการที่ Runtime อยู่บนเครื่องของลูกค้าและ Hub ไม่เห็นเนื้อหา มีเพดานเวลาของ session และบางตัวกรองเน็ตได้แค่ระดับ CIDR
- **Landlock + seccomp อย่างเดียวบน Linux**: ไม่ต้องใช้ user namespace แต่กรองเน็ตได้แค่ระดับ port ไม่ได้ระดับ host และ Codex เองก็ถอยไปใช้ bubblewrap แล้ว เราใช้ Landlock เป็นชั้นที่สองเมื่อ kernel รองรับ
- **gVisor rootless**: ใช้เน็ตของเครื่องและไม่สนใจ cgroups

## Consequences

- บน Ubuntu 24.04 ขึ้นไป ตัวติดตั้งต้องใส่ AppArmor profile ที่อนุญาต user namespace ให้ bwrap ตัวเดียว ไม่ให้ลูกค้าตั้ง `kernel.apparmor_restrict_unprivileged_userns=0` ทั้งเครื่อง profile ที่ Ubuntu มีให้ (`bwrap-userns-restrict`) ปิดไว้เป็นค่าเริ่มต้น และ Ubuntu เองบอกว่าข้อจำกัดนี้ไม่ใช่กำแพงจริง
- profile ของ macOS ต้องจำกัด `mach-lookup` เป็นรายชื่อ แทน `(allow mach-lookup)` ที่เปิดทุก service และต้องมี test ที่รันบน macOS รุ่นใหม่ทุกครั้ง เพราะ `sandbox-exec` ถูกประกาศเลิกใช้มานานแล้ว และ path ระบบเปลี่ยนได้ เช่น macOS 27 beta ทำให้ helper ของ Simulator พังวนเพราะ Metal ย้ายที่เก็บ cache
- `localhost` ใน Seatbelt จับคู่ทุก address ของเครื่อง LAN ด้วย (มีคนลองบน macOS 15.7) dev server บน macOS จึงต้อง bind ที่ loopback เท่านั้น
- dev server ที่ Member จะเปิดดูจากมือถือต้องให้ supervisor forward port ผ่าน Hub เฉพาะคนที่มีสิทธิ์ ข้อนี้ยังไม่มี ADR
- Chromium บน macOS ต้องเพิ่มรายชื่อ mach-lookup ให้ ยังไม่ได้ทดลอง
- ต้องทดลองก่อนเปิดใช้: worker ใต้ sandbox ครบหนึ่ง Turn, network namespace คงอยู่ข้าม Turn ได้, AppArmor profile ของ bwrap และ VM ที่ไม่มี NIC ของชั้น 2

# 📦 Ivy Skills Manifest

> File nay duoc **tu dong sinh/cap nhat** boi `scripts\sync-ivy-skills.ps1`. Khong sua tay truc tiep noi dung bang o duoi - hay chay lai script de refresh.

| Thuoc tinh | Gia tri |
| :--- | :--- |
| **Nguon (Source)** | `D:\Projects\kleinfernwirktechnik\.github\skills` |
| **Dich (Destination)** | `.github/skills/` |
| **Lan dong bo gan nhat** | `2026-09-04 12:34:44` |
| **So skill dong bo thanh cong** | 14 / 14 |

## Danh muc Skills

| # | Skill | Trang thai | Duong dan nguon |
| :-: | :--- | :-: | :--- |
| 1 | `axon-ivy-workflow-guide` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\process-workflow\skills\axon-ivy-workflow-guide` |
| 2 | `axon-ivy-process` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\process-workflow\skills\axon-ivy-process` |
| 3 | `axon-ivy-process-verify` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\process-workflow\skills\axon-ivy-process-verify` |
| 4 | `axon-ivy-verify-story` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\delivery-workflow\skills\axon-ivy-verify-story` |
| 5 | `axon-ivy-requirements-creation` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\delivery-workflow\skills\axon-ivy-requirements-creation` |
| 6 | `axon-ivy-html` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\ui\skills\axon-ivy-html` |
| 7 | `axon-ivy-primefaces-verify` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\ui\skills\axon-ivy-primefaces-verify` |
| 8 | `axon-ivy-cms` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\ui\skills\axon-ivy-cms` |
| 9 | `axon-ivy-cms-verify` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\ui\skills\axon-ivy-cms-verify` |
| 10 | `axon-ivy-custom-fields` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\configuration\skills\axon-ivy-custom-fields` |
| 11 | `axon-ivy-user-role-config` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\configuration\skills\axon-ivy-user-role-config` |
| 12 | `axon-ivy-variable-config` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\configuration\skills\axon-ivy-variable-config` |
| 13 | `axon-ivy-rest` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\integrations\skills\axon-ivy-rest` |
| 14 | `axon-ivy-error-handling` | ✅ OK | `D:\Projects\kleinfernwirktechnik\.github\skills\process-workflow\skills\axon-ivy-error-handling` |

## Cach su dung

```powershell
# Dong bo lai toan bo 14 skill Tier-1 mac dinh:
.\scripts\sync-ivy-skills.ps1

# Chi dong bo mot vai skill cu the:
.\scripts\sync-ivy-skills.ps1 -SkillNames axon-ivy-process,axon-ivy-html

# Dong bo tu mot nguon khac (vd: du an Ivy khac):
.\scripts\sync-ivy-skills.ps1 -Source "D:\Projects\<other-ivy-project>\.github\skills"
```


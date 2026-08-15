// 自動生成ファイル。手で編集しないこと。
// 生成元: docs/spec/basic_commands.yaml / docs/spec/basic_tokens.yaml
// 生成コマンド: npm run gen (tools/gen_command_table.mjs)
//
// yaml に無いが実装上必要な例外（AUTO の予約語登録、POIPUT/PIOPUT の表記差など）は
// ここには含めない。呼び出し側 (src/basic/token.ts, src/basic/parser.ts) で
// 理由つきの例外リストとして別管理する。

/** basic_tokens.yaml の予約語表（141件、yaml記載順）。 */
export const TOKEN_KEYWORDS: readonly string[] = ["MON","RUN","NEW","CONT","PASS","LIST","LLIST","CLOAD","RENUM","LOAD","DELETE","FILES","LCOPY","CSAVE","OPEN","CLOSE","SAVE","RANDOMIZE","DEGREE","RADIAN","GRAD","BEEP","WAIT","GOTO","TRON","TROFF","CLEAR","USING","DIM","CALL","POKE","GPRINT","PSET","PRESET","ERASE","LFILES","KILL","OUT","PIOSET","POIPUT","SPOUT","SPINP","HDCOPY","ENDIF","REPEAT","UNTIL","CLS","LOCATE","TO","STEP","THEN","ON","IF","FOR","LET","REM","END","NEXT","STOP","READ","DATA","PRINT","INPUT","GOSUB","LNINPUT","LPRINT","RETURN","RESTORE","GCURSOR","LINE","CIRCLE","PAINT","OUTPUT","APPEND","AS","ELSE","WHILE","WEND","SWITCH","CASE","DEFAULT","ENDSWITCH","MDF","REC","POL","TEN","RCP","SQU","CUR","HSN","HCS","HTN","AHS","AHC","AHT","FACT","LN","LOG","EXP","SQR","SIN","COS","TAN","INT","ABS","SGN","DEG","DMS","ASN","ACS","ATN","RND","AND","OR","NOT","PEEK","XOR","INP","PIOGET","POINT","PI","FRE","EOF","LOF","NCR","NPR","CUB","MOD","FIX","ASC","VAL","LEN","VDEG","INKEY$","MID$","LEFT$","RIGHT$","CHR$","STR$","HEX$","DMS$"];

export type CommandPhase = 1 | 2 | 3;

export interface GeneratedFunctionSpec {
  readonly name: string;
  readonly phase: CommandPhase;
  /** true なら括弧・引数を取らない（PI, FRE, MDF, INKEY$, PIOGET）。 */
  readonly noParen: boolean;
}

/** basic_commands.yaml の kind: function 全命令（54件）。phase・noParen も yaml から機械導出。 */
export const GENERATED_FUNCTIONS: readonly GeneratedFunctionSpec[] = [
  { name: "ABS", phase: 1, noParen: false },
  { name: "ACS", phase: 1, noParen: false },
  { name: "AHC", phase: 1, noParen: false },
  { name: "AHS", phase: 1, noParen: false },
  { name: "AHT", phase: 1, noParen: false },
  { name: "ASC", phase: 1, noParen: false },
  { name: "ASN", phase: 1, noParen: false },
  { name: "ATN", phase: 1, noParen: false },
  { name: "CHR$", phase: 1, noParen: false },
  { name: "COS", phase: 1, noParen: false },
  { name: "CUB", phase: 1, noParen: false },
  { name: "CUR", phase: 1, noParen: false },
  { name: "DEG", phase: 1, noParen: false },
  { name: "DMS", phase: 1, noParen: false },
  { name: "DMS$", phase: 1, noParen: false },
  { name: "EOF", phase: 3, noParen: false },
  { name: "EXP", phase: 1, noParen: false },
  { name: "FACT", phase: 1, noParen: false },
  { name: "FIX", phase: 1, noParen: false },
  { name: "FRE", phase: 1, noParen: true },
  { name: "HCS", phase: 1, noParen: false },
  { name: "HEX$", phase: 1, noParen: false },
  { name: "HSN", phase: 1, noParen: false },
  { name: "HTN", phase: 1, noParen: false },
  { name: "INKEY$", phase: 1, noParen: true },
  { name: "INP", phase: 2, noParen: false },
  { name: "INT", phase: 1, noParen: false },
  { name: "LEFT$", phase: 1, noParen: false },
  { name: "LEN", phase: 1, noParen: false },
  { name: "LN", phase: 1, noParen: false },
  { name: "LOF", phase: 3, noParen: false },
  { name: "LOG", phase: 1, noParen: false },
  { name: "MDF", phase: 1, noParen: true },
  { name: "MID$", phase: 1, noParen: false },
  { name: "NCR", phase: 1, noParen: false },
  { name: "NPR", phase: 1, noParen: false },
  { name: "PEEK", phase: 2, noParen: false },
  { name: "PI", phase: 1, noParen: true },
  { name: "PIOGET", phase: 2, noParen: true },
  { name: "POINT", phase: 1, noParen: false },
  { name: "POL", phase: 1, noParen: false },
  { name: "RCP", phase: 1, noParen: false },
  { name: "REC", phase: 1, noParen: false },
  { name: "RIGHT$", phase: 1, noParen: false },
  { name: "RND", phase: 1, noParen: false },
  { name: "SGN", phase: 1, noParen: false },
  { name: "SIN", phase: 1, noParen: false },
  { name: "SQR", phase: 1, noParen: false },
  { name: "SQU", phase: 1, noParen: false },
  { name: "STR$", phase: 1, noParen: false },
  { name: "TAN", phase: 1, noParen: false },
  { name: "TEN", phase: 1, noParen: false },
  { name: "VAL", phase: 1, noParen: false },
  { name: "VDEG", phase: 1, noParen: false },
];

export interface GeneratedStatementPhaseSpec {
  readonly name: string;
  readonly phase: 2 | 3;
}

/**
 * basic_commands.yaml の kind: statement/command のうち phase 2/3 の命令で、
 * かつ basic_tokens.yaml に同名の予約語が実在するもの。
 *
 * yaml 上は phase 2/3 だが除外される命令（単独の予約語ではない、または
 * 未実装で tokens.yaml に対応する項目が無いもの）:
 * - BLOAD
 * - BLOAD ?
 * - BLOAD M
 * - BSAVE
 * - BSAVE M
 * - INPUT#
 * - LNINPUT#
 * - PIOPUT
 * - PRINT#
 * - PRINT->LPRINT
 */
export const GENERATED_STATEMENT_PHASES: readonly GeneratedStatementPhaseSpec[] = [
  { name: "CALL", phase: 2 },
  { name: "CLOAD", phase: 3 },
  { name: "CLOSE", phase: 3 },
  { name: "CSAVE", phase: 3 },
  { name: "FILES", phase: 3 },
  { name: "HDCOPY", phase: 3 },
  { name: "KILL", phase: 3 },
  { name: "LFILES", phase: 3 },
  { name: "LLIST", phase: 3 },
  { name: "LOAD", phase: 3 },
  { name: "LPRINT", phase: 3 },
  { name: "MON", phase: 2 },
  { name: "OPEN", phase: 3 },
  { name: "OUT", phase: 2 },
  { name: "PIOSET", phase: 2 },
  { name: "POKE", phase: 2 },
  { name: "SAVE", phase: 3 },
  { name: "SPINP", phase: 3 },
  { name: "SPOUT", phase: 3 },
];

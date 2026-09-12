grammar Rank

interface Expression {}

entry Program:
    NL*
    (statements+=Statement
        (NL+ statements+=Statement)*)?
    NL*;

Statement:
    UseStatement |
    RunStatement |
    OptionStatement |
    ArgumentStatement |
    FlagStatement |
    ArgsStatement |
    TestStatement |
    FunctionStatement |
    YieldStatement |
    ReturnStatement |
    BreakStatement |
    ContinueStatement |
    TryStatement |
    IfStatement |
    ForStatement |
    PushStatement |
    AddStatement |
    IndexAssignmentStatement |
    UnpackStatement |
    ArrayAssignmentStatement |
    AssignmentStatement |
    ExpressionStatement;

UseStatement:
    'use' (module=WORD | path=STRING ('as' alias=Identifier)?);

RunStatement:
    'run' path=STRING?;

OptionStatement:
    'option' name=VARIABLE valueType=WORD (many?='many')?
    ('=' defaultValue=Expression)?;

ArgumentStatement:
    'argument' name=VARIABLE valueType=WORD (many?='many')?
    ('=' defaultValue=Expression)?;

FlagStatement:
    'flag' name=VARIABLE ('=' defaultValue=BooleanValue)?;

ArgsStatement:
    'args' values+=PrimaryExpression+;

TestStatement:
    'test' description=STRING NL+
    (statements+=Statement (NL+ statements+=Statement)*)?
    NL* 'end';

FunctionStatement:
    ('fun' | memo?='memo') name=WORD parameters+=Identifier* NL+
    (statements+=Statement (NL+ statements+=Statement)*)?
    NL* 'end';

ReturnStatement:
    'return' value=Expression?;

YieldStatement:
    'yield' value=Expression;

BreakStatement:
    {infer BreakStatement} 'break';

ContinueStatement:
    {infer ContinueStatement} 'continue';

TryStatement:
    'try' NL+
    (statements+=Statement (NL+ statements+=Statement)*)?
    NL* (
        (catches+=CatchClause NL*)+
        ('finally' NL+
            (finallyStatements+=Statement
                (NL+ finallyStatements+=Statement)*)? NL*)? |
        'finally' NL+
        (finallyStatements+=Statement
            (NL+ finallyStatements+=Statement)*)? NL*
    )
    'end';

CatchClause:
    'catch' errorKind=LabelLiteral? errorName=VARIABLE NL+
    (statements+=Statement (NL+ statements+=Statement)*)?;

IfStatement:
    'if' condition=Expression NL+
    (thenStatements+=Statement (NL+ thenStatements+=Statement)*)?
    NL* (elifClauses+=ElifClause)*
    ('else' NL+
        (elseStatements+=Statement (NL+ elseStatements+=Statement)*)?
        NL*)?
    'end';

ElifClause:
    'elif' condition=Expression NL+
    (statements+=Statement (NL+ statements+=Statement)*)?
    NL*;

ForStatement:
    'for' condition=Expression? NL+
    (statements+=Statement (NL+ statements+=Statement)*)?
    NL* 'end';

PushStatement:
    receiver=Expression 'push' value=Expression;

AddStatement:
    structure=SET_ADD value=Expression;

IndexAssignmentStatement:
    'index' keys+=PrimaryExpression+ '=' value=Expression;

UnpackStatement:
    'unpack' names+=UnpackTarget+ '=' value=Expression;

ArrayAssignmentStatement:
    name=AssignableName indices+=AddressItem+
    operator=AssignmentOperator value=Expression;

AssignmentStatement:
    name=AssignableName operator=AssignmentOperator value=Expression;

AssignmentOperator returns string:
    '=' | '+=' | '-=' | '*=' | '**=' | '/=' | '//=' | '%=' |
    'and=' | 'or=' | 'xor=';

ExpressionStatement:
    value=Expression;

Expression returns Expression:
    OrExpression;

ArrayExpression:
    'array' (
        'shape' dimensions+=ArrayItem+ (
            'pad' fill=Expression |
            NL+ (rows+=ArrayRow NL+)* 'end'
        ) |
        items+=ArrayItem+
    );

RecordExpression:
    'record' NL+
    (fields+=RecordField NL+)*
    'end';

RecordField:
    '.' name=Identifier '=' value=Expression;

ArrayRow:
    items+=ArrayItem+;

ArrayItem:
    sign=('+' | '-')? value=ArrayAtom;

AddressItem:
    spread?='unpack' value=ArrayAtom |
    sign=('+' | '-')? value=ArrayAtom |
    all?='#';

OrExpression returns Expression:
    XorExpression
    ({infer BinaryExpression.left=current}
        operator='or' right=XorExpression)*;

XorExpression returns Expression:
    AndExpression
    ({infer BinaryExpression.left=current}
        operator='xor' right=AndExpression)*;

AndExpression returns Expression:
    ComparisonExpression
    ({infer BinaryExpression.left=current}
        operator='and' right=ComparisonExpression)*;

ComparisonExpression returns Expression:
    PaddingExpression
    ({infer BinaryExpression.left=current}
        operator=ComparisonOperator right=PaddingExpression)*;

ComparisonOperator returns string:
    'equal' | 'not' 'equal' | 'less' | 'greater' |
    'at' 'least' | 'at' 'most' | 'multiple' 'by' | 'in' | 'is';

PaddingExpression returns Expression:
    RangeExpression
    ({infer BinaryExpression.left=current}
        operator='pad' right=RangeExpression)?;

RangeExpression returns Expression:
    AdditionExpression
    ({infer BinaryExpression.left=current}
        operator=('to' | 'until') right=AdditionExpression
        ('by' step=AdditionExpression)?)?;

AdditionExpression returns Expression:
    MultiplicationExpression
    ({infer BinaryExpression.left=current}
        operator=('+' | '-') right=MultiplicationExpression)*;

MultiplicationExpression returns Expression:
    PowerExpression
    ({infer BinaryExpression.left=current}
        operator=('*' | '/' | '//' | '%') right=PowerExpression)*;

PowerExpression returns Expression:
    ApplicationExpression
    ({infer BinaryExpression.left=current}
        operator='**' right=PowerExpression)?;

ApplicationExpression returns Expression:
    AliasedTableExpression |
    KeyedSortExpression |
    KeyedGroupExpression |
    KeyedJoinExpression |
    UnaryExpression
    ({infer ApplicationExpression.head=current}
        arguments+=ApplicationArgument)*
    ({infer MaterializeExpression.source=current} 'array')?;

AliasedTableExpression:
    source=PrimaryExpression field=LabelLiteral?
    'alias' name=LabelLiteral;

KeyedSortExpression:
    source=PrimaryExpression operator=(SORT_BY | ARGSORT_BY)
    (fields+=LabelLiteral+ | key=NameExpression);

KeyedGroupExpression:
    source=PrimaryExpression operator=GROUP_BY fields+=LabelLiteral+;

KeyedJoinExpression:
    left=PrimaryExpression right=PrimaryExpression
    (operator=(LEFTJOIN_BY | INNERJOIN_BY) fields+=LabelLiteral+ |
     operator=(LEFTJOIN_ON | INNERJOIN_ON) NL* pairs+=JoinFieldPair+);

JoinFieldPair:
    left=LabelLiteral 'equal' right=LabelLiteral;

UnaryExpression returns Expression:
    UnpackExpression |
    {infer UnaryExpression}
        operator=('+' | '-' | 'not') operand=UnaryExpression |
    ArrayExpression |
    RecordExpression |
    PrimaryExpression;

UnpackExpression:
    'unpack' value=PrimaryExpression;

ApplicationArgument returns Expression:
    UnpackExpression | PrimaryExpression | ArrayExpression;

PrimaryExpression returns Expression:
    ArrayAtom | AllAxisExpression;

AllAxisExpression:
    {infer AllAxisExpression} '#';

ArrayAtom returns Expression:
    NumberLiteral |
    StringLiteral |
    BooleanLiteral |
    LabelLiteral |
    NewStructureExpression |
    StdinExpression |
    NameExpression |
    ParenthesizedExpression;

StdinExpression:
    'stdin' mode=LabelLiteral count=PrimaryExpression?;

NewStructureExpression:
    'new' structure=(WORD | 'index');

NumberLiteral:
    value=(REAL | INTEGER);

StringLiteral:
    value=STRING;

BooleanLiteral:
    value=BooleanValue;

BooleanValue returns boolean:
    'true' | 'false';

LabelLiteral:
    '.' name=(Identifier | 'array' | 'record');

NameExpression:
    name=ReferenceName;

ParenthesizedExpression:
    '(' NL* value=MultilineExpression NL* ')';

MultilineExpression returns Expression:
    MultilineOrExpression;

MultilineOrExpression returns Expression:
    MultilineXorExpression
    ({infer BinaryExpression.left=current}
        NL* operator='or' NL* right=MultilineXorExpression)*;

MultilineXorExpression returns Expression:
    MultilineAndExpression
    ({infer BinaryExpression.left=current}
        NL* operator='xor' NL* right=MultilineAndExpression)*;

MultilineAndExpression returns Expression:
    MultilineComparisonExpression
    ({infer BinaryExpression.left=current}
        NL* operator='and' NL* right=MultilineComparisonExpression)*;

MultilineComparisonExpression returns Expression:
    MultilinePaddingExpression
    ({infer BinaryExpression.left=current}
        NL* operator=ComparisonOperator NL* right=MultilinePaddingExpression)*;

MultilinePaddingExpression returns Expression:
    MultilineRangeExpression
    ({infer BinaryExpression.left=current}
        NL* operator='pad' NL* right=MultilineRangeExpression)?;

MultilineRangeExpression returns Expression:
    MultilineAdditionExpression
    ({infer BinaryExpression.left=current}
        NL* operator=('to' | 'until') NL* right=MultilineAdditionExpression
        (NL* 'by' NL* step=MultilineAdditionExpression)?)?;

MultilineAdditionExpression returns Expression:
    MultilineMultiplicationExpression
    ({infer BinaryExpression.left=current}
        NL* operator=('+' | '-') NL* right=MultilineMultiplicationExpression)*;

MultilineMultiplicationExpression returns Expression:
    MultilinePowerExpression
    ({infer BinaryExpression.left=current}
        NL* operator=('*' | '/' | '//' | '%') NL* right=MultilinePowerExpression)*;

MultilinePowerExpression returns Expression:
    ApplicationExpression
    ({infer BinaryExpression.left=current}
        NL* operator='**' NL* right=MultilinePowerExpression)?;

Identifier returns string:
    VARIABLE | WORD;

AssignableName returns string:
    VARIABLE | QUALIFIED_NAME;

UnpackTarget returns string:
    AssignableName | '#';

ReferenceName returns string:
    VARIABLE | WORD | QUALIFIED_NAME | 'index' | 'shape';

hidden terminal WS: /[\t ]+/;
hidden terminal REM_COMMENT: /rem(?![A-Za-z0-9_])(?:[\t ]+[^\n\r]*)?/;
terminal NL: /\r?\n/;
terminal QUALIFIED_NAME: /[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*/;
terminal ARGSORT_BY: /argsort[\t ]+by/;
terminal SORT_BY: /sort[\t ]+by/;
terminal GROUP_BY: /group[\t ]+by/;
terminal LEFTJOIN_BY: /leftjoin[\t ]+by/;
terminal INNERJOIN_BY: /innerjoin[\t ]+by/;
terminal LEFTJOIN_ON: /leftjoin[\t ]+on/;
terminal INNERJOIN_ON: /innerjoin[\t ]+on/;
terminal SET_ADD: /(set|counter)[\t ]+add/;
terminal VARIABLE: /[A-Z][A-Za-z0-9_]*/;
terminal WORD: /[a-z][A-Za-z0-9_]*/;
terminal REAL returns number: /[0-9]+\.[0-9]+/;
terminal INTEGER returns bigint: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"/;

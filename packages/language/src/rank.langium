grammar Rank

interface Expression {}

interface KeyedRollingExpression extends Expression {
    source: Expression
    width: Expression
    operator: string
    field: LabelLiteral
}

interface KeyedJoinExpression extends Expression {
    left: Expression
    right: Expression
    operator: string
    fields: LabelLiteral[]
    pairs: JoinFieldPair[]
}

interface KeyedReachExpression extends Expression {
    edges: Expression
    starts: Expression
    operator: string
    from: LabelLiteral
    to: LabelLiteral
}

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
    AddStatement |
    IndexAssignmentStatement |
    UnpackStatement |
    ArrayAssignmentStatement |
    AssignmentStatement |
    ExpressionOrPushStatement;

UseStatement:
    'use' (module=(WORD | 'text') | path=STRING ('as' alias=Identifier)?);

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
    ('fun' | memo?='memo') name=(WORD | 'text' | 'first' | 'take' | 'update' | 'ascending' | 'descending') parameters+=Identifier* NL+
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

ExpressionOrPushStatement:
    Expression (
        {infer PushStatement.receiver=current} 'push' value=Expression |
        {infer ExpressionStatement.value=current}
    );

Expression returns Expression:
    OrExpression;

ArrayExpression:
    'array' (
        'shape' dimensions+=ArrayItem+ (
            'fill' fill=Expression |
            NL+ (rows+=ArrayRow NL+)* 'end'
        ) |
        items+=ArrayItem+
    );

// One quoted line per source line, glued or joined by `lines`. `rem` lines are
// hidden and blank lines collapse into NL+, so only the quoted lines remain.
TextBlockExpression:
    'text' mode=WORD? NL+ (parts+=STRING NL+)* 'end';

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

// A filter condition may drop its leading operand: the filtered value itself
// becomes the left side, so `filter greater 5` reads as `each value greater 5`.
// Field paths already elide the same subject in table conditions.
FilterCondition returns Expression:
    SubjectComparisonChain | Expression;

// The chain starts with a comparison, which keeps it apart from an ordinary
// expression. Later operands may also be plain predicates: `greater 5 and even`.
SubjectComparisonChain returns Expression:
    SubjectComparison
    ({infer BinaryExpression.left=current}
        operator=('or' | 'and' | 'xor')
        (right=SubjectComparison | right=NotExpression))*;

SubjectComparison returns Expression:
    {infer SubjectComparisonExpression} operator=ComparisonOperator right=DefaultExpression;

OrExpression returns Expression:
    XorExpression
    ({infer BinaryExpression.left=current}
        operator='or' right=XorExpression)*;

XorExpression returns Expression:
    AndExpression
    ({infer BinaryExpression.left=current}
        operator='xor' right=AndExpression)*;

AndExpression returns Expression:
    NotExpression
    ({infer BinaryExpression.left=current}
        operator='and' right=NotExpression)*;

NotExpression returns Expression:
    {infer UnaryExpression} operator='not' operand=NotExpression |
    ComparisonExpression;

ComparisonExpression returns Expression:
    DefaultExpression
    ({infer BinaryExpression.left=current}
        operator=ComparisonOperator right=DefaultExpression)*;

ComparisonOperator returns string:
    'equal' | 'not' 'equal' | 'less' | 'greater' |
    'at' 'least' | 'at' 'most' | 'multiple' 'by' | 'in' | 'not' 'in' | 'is';

DefaultExpression returns Expression:
    RangeExpression
    ({infer BinaryExpression.left=current}
        operator='default' right=RangeExpression)?;

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

// Parse the recursive primary once before choosing its contextual suffix.
// Repeating PrimaryExpression in every alternative makes LL(*) lookahead
// enumerate combinations of alternatives through nested parentheses.
ApplicationExpression returns Expression:
    PrimaryApplicationExpression |
    TableWritePreviewExpression |
    TextBlockExpression |
    NonPrimaryExpression
    ({infer ApplicationExpression.head=current}
        arguments+=ApplicationArgument)*
    ({infer MaterializeExpression.source=current} 'array')?;

PrimaryApplicationExpression returns Expression:
    PrimaryExpression (
        {infer FirstIndexWhereExpression.source=current} 'first' 'index' 'where' mask=Expression |
        {infer FirstWhereExpression.source=current} 'first' 'where' mask=Expression |
        {infer TakeWhileExpression.source=current} 'take' 'while' mask=Expression |
        {infer TableWriteExpression.source=current} sourceFields+=LabelLiteral?
            ('insert' values+=NameExpression+ |
             'update' NL+ (entries+=SelectEntry NL+)+ 'end' |
             'delete') |
        {infer TableFilterExpression.source=current} sourceFields+=LabelLiteral?
            'filter' (condition=FilterCondition |
                NL+ (conditions+=FilterCondition NL+)+ 'end') |
        {infer TableSelectExpression.source=current} sourceFields+=LabelLiteral?
            'select' (fields+=LabelLiteral+ | columns=NameExpression | columns=ParenthesizedExpression |
                NL+ (entries+=SelectEntry NL+)+ 'end') |
        {infer AliasedTableExpression.source=current} field=LabelLiteral?
            'alias' name=LabelLiteral |
        {infer KeyedSortExpression.source=current} operator=(SORT_BY | ARGSORT_BY)
            (fields+=SortField+ | key=NameExpression direction=SortDirection?) |
        {infer KeyedGroupExpression.source=current} operator=(GROUP_BY | ROLLUP_BY) fields+=LabelLiteral+ |
        // A second primary is shared by ordinary calls and keyed operations.
        // Normalize this temporary node to the public AST after parsing.
        {infer PrimaryTailExpression.head=current} argument=PrimaryExpression (
            operator=ROLLING_BY field=LabelLiteral |
            operator=(LEFTJOIN_BY | INNERJOIN_BY) fields+=LabelLiteral+ |
            operator=(LEFTJOIN_ON | INNERJOIN_ON) NL* pairs+=JoinFieldPair+ |
            operator=REACH_BY from=LabelLiteral to=LabelLiteral |
            arguments+=ApplicationArgument*
                ({infer MaterializeExpression.source=current} 'array')?
        ) |
        {infer ApplicationExpression.head=current} arguments+=NonPrimaryArgument
            arguments+=ApplicationArgument*
            ({infer MaterializeExpression.source=current} 'array')? |
        ({infer MaterializeExpression.source=current} 'array')?
    );

TableWriteExpression:
    source=PrimaryExpression sourceFields+=LabelLiteral?
    ('insert' values+=NameExpression+ |
     'update' NL+ (entries+=SelectEntry NL+)+ 'end' |
     'delete');

TableWritePreviewExpression:
    mode=('sql' | 'explain') write=TableWriteExpression;

SelectEntry:
    RecordField | SelectLocal;

SelectLocal:
    name=VARIABLE '=' value=Expression;

SortField:
    field=LabelLiteral direction=SortDirection?;

SortDirection returns string:
    '.' ('ascending' | 'descending');

JoinFieldPair:
    left=LabelLiteral 'equal' right=LabelLiteral;

UnaryExpression returns Expression:
    NonPrimaryExpression | PrimaryExpression;

NonPrimaryExpression returns Expression:
    UnpackExpression |
    {infer UnaryExpression}
        operator=('+' | '-') operand=UnaryExpression |
    ArrayExpression |
    RecordExpression;

UnpackExpression:
    'unpack' value=PrimaryExpression;

ApplicationArgument returns Expression:
    NonPrimaryArgument | PrimaryExpression;

NonPrimaryArgument returns Expression:
    UnpackExpression | ArrayExpression;

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
    MultilineNotExpression
    ({infer BinaryExpression.left=current}
        NL* operator='and' NL* right=MultilineNotExpression)*;

MultilineNotExpression returns Expression:
    {infer UnaryExpression} operator='not' NL* operand=MultilineNotExpression |
    MultilineComparisonExpression;

MultilineComparisonExpression returns Expression:
    MultilineDefaultExpression
    ({infer BinaryExpression.left=current}
        NL* operator=ComparisonOperator NL* right=MultilineDefaultExpression)*;

MultilineDefaultExpression returns Expression:
    MultilineRangeExpression
    ({infer BinaryExpression.left=current}
        NL* operator='default' NL* right=MultilineRangeExpression)?;

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
    VARIABLE | WORD | 'text' | 'first' | 'take' | 'filter' | 'select' | 'sql' | 'explain' | 'insert' | 'update' | 'delete' | 'ascending' | 'descending';

AssignableName returns string:
    VARIABLE | QUALIFIED_NAME;

UnpackTarget returns string:
    AssignableName | '#';

ReferenceName returns string:
    VARIABLE | WORD | QUALIFIED_NAME | 'text' | 'first' | 'take' | 'index' | 'shape' | 'sql' | 'explain' | 'update' | 'ascending' | 'descending';

hidden terminal WS: /[\t ]+/;
hidden terminal REM_COMMENT: /rem(?![A-Za-z0-9_])(?:[\t ]+[^\n\r]*)?/;
terminal NL: /\r?\n/;
terminal QUALIFIED_NAME: /[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*/;
terminal ARGSORT_BY: /argsort[\t ]+by/;
terminal SORT_BY: /sort[\t ]+by/;
terminal GROUP_BY: /group[\t ]+by/;
terminal ROLLUP_BY: /rollup[\t ]+by/;
terminal ROLLING_BY: /rolling[\t ]+by/;
terminal REACH_BY: /reach[\t ]+by/;
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

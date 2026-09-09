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
    ReturnStatement |
    BreakStatement |
    TryStatement |
    IfStatement |
    ForStatement |
    PushStatement |
    IndexAssignmentStatement |
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
    'fun' name=WORD parameters+=Identifier* NL+
    (statements+=Statement (NL+ statements+=Statement)*)?
    NL* 'end';

ReturnStatement:
    'return' value=Expression;

BreakStatement:
    {infer BreakStatement} 'break';

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
    NL* ('else' NL+
        (elseStatements+=Statement (NL+ elseStatements+=Statement)*)?
        NL*)?
    'end';

ForStatement:
    'for' condition=Expression? NL+
    (statements+=Statement (NL+ statements+=Statement)*)?
    NL* 'end';

PushStatement:
    receiver=Expression 'push' value=Expression;

IndexAssignmentStatement:
    'index' keys+=PrimaryExpression+ '=' value=Expression;

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
        'shape' dimensions+=ArrayItem+ NL+
        (rows+=ArrayRow NL+)*
        'end' |
        items+=ArrayItem+
    );

ArrayRow:
    items+=ArrayItem+;

ArrayItem:
    sign=('+' | '-')? value=ArrayAtom;

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
    'at' 'least' | 'at' 'most' | 'multiple' 'by' | 'in';

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
    UnaryExpression
    ({infer ApplicationExpression.head=current}
        arguments+=ApplicationArgument)*;

UnaryExpression returns Expression:
    {infer UnaryExpression}
        operator=('+' | '-' | 'not') operand=UnaryExpression |
    ArrayExpression |
    PrimaryExpression;

ApplicationArgument returns Expression:
    PrimaryExpression | ArrayExpression;

PrimaryExpression returns Expression:
    ArrayAtom;

ArrayAtom returns Expression:
    NumberLiteral |
    StringLiteral |
    BooleanLiteral |
    LabelLiteral |
    NameExpression |
    ParenthesizedExpression;

NumberLiteral:
    value=(REAL | INTEGER);

StringLiteral:
    value=STRING;

BooleanLiteral:
    value=BooleanValue;

BooleanValue returns boolean:
    'true' | 'false';

LabelLiteral:
    '.' name=Identifier;

NameExpression:
    name=ReferenceName;

ParenthesizedExpression:
    '(' value=Expression ')';

Identifier returns string:
    VARIABLE | WORD;

AssignableName returns string:
    VARIABLE | QUALIFIED_NAME;

ReferenceName returns string:
    VARIABLE | WORD | QUALIFIED_NAME | 'index';

hidden terminal WS: /[\t ]+/;
hidden terminal REM_COMMENT: /rem(?![A-Za-z0-9_])(?:[\t ]+[^\n\r]*)?/;
terminal NL: /\r?\n/;
terminal QUALIFIED_NAME: /[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*/;
terminal VARIABLE: /[A-Z][A-Za-z0-9_]*/;
terminal WORD: /[a-z][A-Za-z0-9_]*/;
terminal REAL returns number: /[0-9]+\.[0-9]+/;
terminal INTEGER returns bigint: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"/;

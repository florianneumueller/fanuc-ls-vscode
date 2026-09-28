/PROG  SCHWEISS1
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Kehlnaht Bauteil A";
PROG_SIZE	= 1024;
CREATE		= DATE 26-09-18  TIME 07:30:00;
MODIFIED	= DATE 26-09-18  TIME 07:30:00;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 14;
MEMORY_SIZE	= 1400;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= 1,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
/APPL
/MN
   1:  !Kehlnaht Bauteil A ;
   2:  UTOOL_NUM=1 ;
   3:  UFRAME_NUM=1 ;
   4:  R[1]=0 ;
   5:J P[1] 100% CNT100    ;
   6:L P[2] 200mm/sec FINE    ;
   7:  Arc Start[1] ;
   8:L P[3] 10mm/sec FINE    ;
   9:  Arc End[1] ;
  10:L P[4] 500mm/sec CNT100    ;
  11:  DO[1]=ON ;
  12:  IF R[1]<5,JMP LBL[1] ;
  13:  LBL[1:Ende] ;
  14:  END ;
/POS
P[1]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   100.000  mm,	Y =   200.000  mm,	Z =   300.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[2]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   120.000  mm,	Y =   200.000  mm,	Z =   250.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[3]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   320.000  mm,	Y =   200.000  mm,	Z =   250.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[4]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   320.000  mm,	Y =   200.000  mm,	Z =   350.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
P[9]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =     0.000  mm,	Y =     0.000  mm,	Z =     0.000  mm,
	W =     0.000 deg,	P =     0.000 deg,	R =     0.000 deg
};
/END

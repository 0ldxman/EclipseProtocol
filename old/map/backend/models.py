from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from database import Base


class Side(Base):
    __tablename__ = "sides"

    tag = Column(String, primary_key=True)
    label = Column(String, nullable=False)
    color = Column(String, nullable=False)

    countries = relationship("Country", foreign_keys="Country.side", back_populates="side_rel")
    sympathizers = relationship("Country", foreign_keys="Country.sympathy", back_populates="sympathy_rel")


class Country(Base):
    __tablename__ = "countries"

    tag = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    current_name = Column(String, nullable=True)
    color = Column(String, nullable=False)
    part_of = Column(String, ForeignKey("countries.tag"), nullable=True)
    side = Column(String, ForeignKey("sides.tag"), nullable=True)
    sympathy = Column(String, ForeignKey("sides.tag"), nullable=True)

    side_rel = relationship("Side", foreign_keys=[side], back_populates="countries")
    sympathy_rel = relationship("Side", foreign_keys=[sympathy], back_populates="sympathizers")
    parent = relationship("Country", remote_side=[tag], foreign_keys=[part_of])

    @property
    def display_name(self):
        return self.current_name or self.name


class Province(Base):
    __tablename__ = "provinces"

    fid = Column(Integer, primary_key=True)
    owner = Column(String, ForeignKey("countries.tag"), nullable=True)
    occupied_by = Column(String, ForeignKey("countries.tag"), nullable=True)

    owner_rel = relationship("Country", foreign_keys=[owner])
    occupier_rel = relationship("Country", foreign_keys=[occupied_by])
